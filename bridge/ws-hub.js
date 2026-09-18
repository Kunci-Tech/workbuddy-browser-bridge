// WebSocket Hub — shared transport between the Chrome extension and any local agent.
//
// The extension is always the WebSocket *client*: it dials out to 127.0.0.1 and
// reconnects on its own. This hub is the *server* side. Two processes host it:
//
//   - bridge/server.js  → standalone HTTP + WS (Antigravity, manual use, debugging)
//   - mcp/server.js     → MCP stdio server + WS (spawned automatically by WorkBuddy)
//
// Both share this module so the wire protocol and frame handling stay identical.

const crypto = require("crypto");
const http = require("http");

// Minimalist RFC 6455 implementation — zero dependencies.
function createHub(options = {}) {
  const {
    port,
    host = "127.0.0.1",
    defaultAgentId = "workbuddy",
    requestHandler: initialRequestHandler = null,
    logger = console
  } = options;

  // Mutable so a caller can attach a handler after the hub exists — that lets the
  // handler close over the hub itself (which is impossible during construction).
  let requestHandler = initialRequestHandler;

  const extensionSockets = {}; // agentId -> net.Socket
  const pendingRequests = new Map(); // requestId -> { resolve, reject, timer }

  const server = http.createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Agent-Id");
    res.setHeader("Content-Type", "application/json");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      return res.end();
    }

    if (!requestHandler) {
      res.writeHead(404);
      return res.end(JSON.stringify({ error: "Endpoint not found" }));
    }

    try {
      const handled = await requestHandler(req, res, api);
      if (!handled) {
        res.writeHead(404);
        res.end(JSON.stringify({ error: "Endpoint not found" }));
      }
    } catch (err) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: err.message || String(err) }));
    }
  });

  // --- WebSocket upgrade ---
  server.on("upgrade", (req, socket) => {
    const key = req.headers["sec-websocket-key"];
    if (!key) {
      socket.destroy();
      return;
    }

    const acceptKey = crypto
      .createHash("sha1")
      .update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
      .digest("base64");

    socket.write([
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${acceptKey}`,
      "\r\n"
    ].join("\r\n"));

    // Agent is chosen by URL path (/ws/<agentId>) or falls back to the default.
    const urlPath = req.url || "";
    const pathMatch = urlPath.match(/^\/ws\/([\w-]+)/);
    const agentId = pathMatch ? pathMatch[1] : defaultAgentId;

    if (extensionSockets[agentId]) {
      try { extensionSockets[agentId].destroy(); } catch (_) {}
    }
    extensionSockets[agentId] = socket;
    logger.log(`[Bridge] Chrome extension connected (agent: ${agentId})`);

    let buffer = Buffer.alloc(0);
    let messageFragments = [];

    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);

      while (buffer.length >= 2) {
        const firstByte = buffer[0];
        const secondByte = buffer[1];
        const isFin = Boolean(firstByte & 0x80);
        const opcode = firstByte & 0x0f;
        const isMasked = Boolean(secondByte & 0x80);
        let payloadLen = secondByte & 0x7f;
        let offset = 2;

        if (payloadLen === 126) {
          if (buffer.length < 4) return;
          payloadLen = buffer.readUInt16BE(2);
          offset = 4;
        } else if (payloadLen === 127) {
          if (buffer.length < 10) return;
          payloadLen = Number(buffer.readBigUInt64BE(2));
          offset = 10;
        }

        const maskSize = isMasked ? 4 : 0;
        if (buffer.length < offset + maskSize + payloadLen) return;

        const mask = isMasked ? buffer.slice(offset, offset + 4) : null;
        const unmasked = Buffer.alloc(payloadLen);

        for (let i = 0; i < payloadLen; i++) {
          unmasked[i] = buffer[offset + maskSize + i] ^ (isMasked ? mask[i % 4] : 0);
        }

        buffer = buffer.slice(offset + maskSize + payloadLen);

        if (opcode === 0x8) {
          socket.end();
          if (extensionSockets[agentId] === socket) extensionSockets[agentId] = null;
          return;
        } else if (opcode === 0x9) {
          sendWsFrame(socket, 0xa, unmasked);
        } else if (opcode === 0x1 || opcode === 0x0) {
          messageFragments.push(unmasked);
          if (isFin) {
            const full = Buffer.concat(messageFragments).toString("utf8");
            messageFragments = [];
            handleMessage(full, agentId);
          }
        }
      }
    });

    socket.on("close", () => {
      logger.log(`[Bridge] Chrome extension disconnected (agent: ${agentId})`);
      if (extensionSockets[agentId] === socket) extensionSockets[agentId] = null;
    });

    socket.on("error", (err) => {
      logger.error(`[Bridge] Socket error (${agentId}):`, err.message);
      if (extensionSockets[agentId] === socket) extensionSockets[agentId] = null;
    });
  });

  function handleMessage(text, agentId) {
    try {
      const data = JSON.parse(text);

      if (data.type === "REGISTER") {
        logger.log(`[Bridge] Registered: ${data.client} (agent=${data.agent || agentId}, v${data.version})`);
        return;
      }
      if (data.type === "PING") {
        sendWsFrame(extensionSockets[agentId], 0x1, JSON.stringify({ type: "PONG" }));
        return;
      }

      if (data.id && pendingRequests.has(data.id)) {
        const { resolve, reject, timer } = pendingRequests.get(data.id);
        clearTimeout(timer);
        pendingRequests.delete(data.id);
        if (data.success) {
          resolve(data.result);
        } else {
          reject(new Error(data.error || "Extension command failed"));
        }
      }
    } catch (err) {
      logger.error("[Bridge] Error parsing extension message:", err.message);
    }
  }

  function sendWsFrame(socket, opcode, payload) {
    if (!socket || socket.destroyed) return;
    const payloadBuf = Buffer.isBuffer(payload) ? payload : Buffer.from(payload, "utf8");
    const len = payloadBuf.length;

    let header;
    if (len <= 125) {
      header = Buffer.from([0x80 | opcode, len]);
    } else if (len <= 65535) {
      header = Buffer.alloc(4);
      header[0] = 0x80 | opcode;
      header[1] = 126;
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x80 | opcode;
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(len), 2);
    }

    socket.write(Buffer.concat([header, payloadBuf]));
  }

  // Send a command to the extension and await its result.
  function executeOnExtension(command, params = {}, agentId = defaultAgentId, timeoutMs = 20000) {
    return new Promise((resolve, reject) => {
      const socket = extensionSockets[agentId];
      if (!socket || socket.destroyed) {
        return reject(new Error(
          `Chrome extension is not connected for agent "${agentId}". ` +
          `Make sure Chrome is open with the Browser Bridge extension loaded.`
        ));
      }

      const id = crypto.randomUUID();
      const timer = setTimeout(() => {
        pendingRequests.delete(id);
        reject(new Error(`Command '${command}' timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      pendingRequests.set(id, { resolve, reject, timer });
      sendWsFrame(socket, 0x1, JSON.stringify({ id, command, params }));
    });
  }

  function isConnected(agentId = defaultAgentId) {
    const socket = extensionSockets[agentId];
    return Boolean(socket && !socket.destroyed);
  }

  function connectedAgents() {
    const out = {};
    for (const [id, socket] of Object.entries(extensionSockets)) {
      out[id] = Boolean(socket && !socket.destroyed);
    }
    return out;
  }

  const api = {
    executeOnExtension,
    isConnected,
    connectedAgents,
    setRequestHandler(fn) { requestHandler = fn; },
    get port() { return port; },
    get defaultAgentId() { return defaultAgentId; }
  };

  function listen(callback) {
    return server.listen(port, host, () => {
      if (callback) callback();
    });
  }

  function close() {
    for (const socket of Object.values(extensionSockets)) {
      try { socket?.destroy(); } catch (_) {}
    }
    try { server.close(); } catch (_) {}
  }

  return { server, listen, close, ...api };
}

module.exports = { createHub };
