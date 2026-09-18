#!/usr/bin/env node
// Browser Bridge — MCP Server
//
// This is what makes the extension "just work" with WorkBuddy: WorkBuddy spawns
// this process automatically from ~/.workbuddy-ai/mcp.json, so there is no terminal
// to open and no server to babysit.
//
// Two transports, one process:
//   stdin/stdout  -> MCP (JSON-RPC 2.0, newline-delimited)  <- the AI agent
//   ws://127.0.0.1:8766 <- the Chrome extension dials in
//
// IMPORTANT: stdout carries ONLY protocol frames. Every log goes to stderr,
// otherwise the JSON-RPC stream is corrupted.

const path = require("path");
const http = require("http");

const { createHub } = require(path.join(__dirname, "..", "bridge", "ws-hub.js"));
const { createRouteHandler } = require(path.join(__dirname, "..", "bridge", "routes.js"));
const { AGENTS } = require(path.join(__dirname, "..", "agents", "registry.js"));

const AGENT_ID = "workbuddy";
const PORT = process.env.BRIDGE_PORT ? parseInt(process.env.BRIDGE_PORT, 10) : 8766;

function log(...args) {
  process.stderr.write(`[browser-bridge] ${args.join(" ")}\n`);
}

// --- Hub + REST surface -------------------------------------------------------

const hub = createHub({
  port: PORT,
  defaultAgentId: AGENT_ID,
  logger: { log, error: log }
});

// Attached after construction so the handler can close over `hub` itself.
hub.setRequestHandler(createRouteHandler({ agents: AGENTS, hub, logger: { log, error: log } }));

// If another bridge is already holding the port we fall back to driving the
// extension through its /command endpoint, so WorkBuddy still works.
let proxyMode = false;

hub.server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    proxyMode = true;
    log(`port ${PORT} already in use — delegating to the bridge already listening there`);
  } else {
    log(`server error: ${err.message}`);
  }
});

hub.listen(() => {
  log(`MCP server ready on port ${PORT} (agent: ${AGENT_ID})`);
});

// --- Command dispatch ---------------------------------------------------------

function httpPost(url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const payload = JSON.stringify(body);
    const req = http.request({
      hostname: u.hostname,
      port: u.port,
      path: u.pathname,
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) }
    }, (res) => {
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(json.result !== undefined ? json.result : json);
          } else {
            reject(new Error(json.error || `HTTP ${res.statusCode}`));
          }
        } catch (_) {
          reject(new Error(`Bad response: ${data.slice(0, 200)}`));
        }
      });
    });
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

async function callExtension(command, params = {}) {
  if (!proxyMode && hub.isConnected(AGENT_ID)) {
    return await hub.executeOnExtension(command, params, AGENT_ID);
  }
  // Proxy mode, or the socket hasn't landed yet — try the local REST bridge.
  return await httpPost(`http://127.0.0.1:${PORT}/command`, {
    command, params, agentId: AGENT_ID
  });
}

async function ensureExtensionReady() {
  if (!proxyMode && hub.isConnected(AGENT_ID)) return;
  try {
    await httpPost(`http://127.0.0.1:${PORT}/command`, { command: "list_tabs", params: {}, agentId: AGENT_ID });
  } catch (_) {
    throw new Error(
      "Chrome extension is not connected. Open Chrome with the Browser Bridge extension " +
      "loaded and enabled, then refresh the page you want to automate."
    );
  }
}

// --- Tool definitions ---------------------------------------------------------

const TOOLS = [
  {
    name: "browser_status",
    description: "Check whether the Chrome extension is connected and which agent is active. Call this first if other browser tools fail.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }
  },
  {
    name: "browser_list_tabs",
    description: "List all open Chrome tabs with their id, title, url and whether each is active.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }
  },
  {
    name: "browser_focus_tab",
    description: "Bring a specific Chrome tab to the front so subsequent actions target it. Match by partial URL or partial title, or pass an exact tab id.",
    inputSchema: {
      type: "object",
      properties: {
        urlContains: { type: "string", description: "Partial URL to match, e.g. 'ads.google.com'" },
        titleContains: { type: "string", description: "Partial page title to match" },
        tabId: { type: "number", description: "Exact Chrome tab id" }
      },
      additionalProperties: false
    }
  },
  {
    name: "browser_navigate",
    description: "Navigate the active tab (or a new tab) to a URL.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Absolute URL to open, e.g. 'https://example.com'" },
        tabId: { type: "number", description: "Optional tab id; omit to use the active tab" }
      },
      required: ["url"],
      additionalProperties: false
    }
  },
  {
    name: "browser_tag_elements",
    description: "Tag every visible interactive element with a numbered Set-of-Mark badge and return the list. Use this to discover clickable targets, then click one by badgeId. Far more reliable than guessing coordinates.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }
  },
  {
    name: "browser_click",
    description: "Click an element. Prefer badgeId (from browser_tag_elements) for a target already on screen - it is a direct element reference. Badges only cover the current viewport, so for anything below the fold use text instead: text targeting scrolls the element into view, waits for the scroll to settle, and verifies the click point actually reaches the element before clicking. CSS selector and explicit x/y are also accepted. High-stakes targets (delete, pay, transfer) pause for human approval unless force is true.",
    inputSchema: {
      type: "object",
      properties: {
        badgeId: { type: "number", description: "Badge number from browser_tag_elements (on-screen targets only)" },
        text: { type: "string", description: "Visible text of the element to click. Scrolls it into view and verifies the click point before clicking, so it works below the fold." },
        selector: { type: "string", description: "CSS selector for the element" },
        x: { type: "number", description: "Viewport x coordinate" },
        y: { type: "number", description: "Viewport y coordinate" },
        actionLabel: { type: "string", description: "Short human-readable label shown on the visual cursor" },
        force: { type: "boolean", description: "Skip the high-stakes guardrail confirmation" }
      },
      additionalProperties: false
    }
  },
  {
    name: "browser_type",
    description: "Type text into the focused input using real native keystrokes. Click the field first with browser_click.",
    inputSchema: {
      type: "object",
      properties: { text: { type: "string", description: "The text to type" } },
      required: ["text"],
      additionalProperties: false
    }
  },
  {
    name: "browser_screenshot",
    description: "Capture the visible area of the active tab as a PNG image. Use this to see what is currently on screen.",
    inputSchema: {
      type: "object",
      properties: {
        format: { type: "string", enum: ["png", "jpeg"], description: "Image format, defaults to png" }
      },
      additionalProperties: false
    }
  },
  {
    name: "browser_get_dom",
    description: "Extract a structured summary of the page: title, url, headings and the visible interactive elements with their coordinates.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }
  },
  {
    name: "browser_clear_tags",
    description: "Remove all Set-of-Mark badges from the page. Call this when you are done clicking to leave the page clean.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }
  },
  {
    name: "browser_detect_challenge",
    description: "Check whether the page is showing a CAPTCHA, Cloudflare Turnstile or 2FA prompt that needs a human. If challenged, ask the user to solve it.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }
  }
];

// --- Tool execution -----------------------------------------------------------

function text(value) {
  const body = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return { content: [{ type: "text", text: body }] };
}

async function runTool(name, args = {}) {
  switch (name) {
    case "browser_status": {
      let connected = !proxyMode && hub.isConnected(AGENT_ID);
      if (!connected) {
        try {
          const res = await httpPost(`http://127.0.0.1:${PORT}/command`, { command: "list_tabs", params: {}, agentId: AGENT_ID });
          connected = Array.isArray(res);
        } catch (_) { connected = false; }
      }
      return text({
        connected,
        agent: AGENT_ID,
        port: PORT,
        mode: proxyMode ? "proxied" : "direct",
        hint: connected
          ? "Ready. Use browser_list_tabs or browser_tag_elements to begin."
          : "Extension not connected. Open Chrome with the Browser Bridge extension enabled."
      });
    }

    case "browser_list_tabs": {
      await ensureExtensionReady();
      const tabs = await callExtension("list_tabs");
      return text(tabs);
    }

    case "browser_focus_tab": {
      await ensureExtensionReady();
      const res = await callExtension("focus_tab", {
        urlContains: args.urlContains,
        titleContains: args.titleContains,
        tabId: args.tabId
      });
      return text(res);
    }

    case "browser_navigate": {
      if (!args.url) throw new Error("url is required");
      await ensureExtensionReady();
      const res = await callExtension("navigate", { url: args.url, tabId: args.tabId });
      return text(res);
    }

    case "browser_tag_elements": {
      await ensureExtensionReady();
      const catalog = await callExtension("tag_elements");
      if (!catalog || !catalog.elements) return text({ taggedCount: 0, elements: [] });
      // Trim to what the model actually needs.
      const elements = catalog.elements.map(e => ({
        badgeId: e.badgeId,
        tag: e.tag,
        text: e.text,
        type: e.type,
        role: e.role
      }));
      return text({
        taggedCount: catalog.taggedCount,
        elements,
        hint: "Click one with browser_click { badgeId: N }."
      });
    }

    case "browser_click": {
      await ensureExtensionReady();

      if (args.badgeId !== undefined) {
        const res = await callExtension("click_badge", {
          badgeId: args.badgeId,
          actionLabel: args.actionLabel
        });
        return text(res);
      }

      const payload = {
        x: args.x,
        y: args.y,
        text: args.text,
        selector: args.selector,
        actionLabel: args.actionLabel,
        force: args.force
      };
      const res = await callExtension("click", payload);
      return text(res);
    }

    case "browser_type": {
      if (typeof args.text !== "string") throw new Error("text is required");
      await ensureExtensionReady();
      const res = await callExtension("type", { text: args.text });
      return text(res);
    }

    case "browser_screenshot": {
      await ensureExtensionReady();
      const res = await callExtension("screenshot", { format: args.format || "png" });
      if (res && res.screenshot) {
        return {
          content: [{
            type: "image",
            data: res.screenshot,
            mimeType: args.format === "jpeg" ? "image/jpeg" : "image/png"
          }]
        };
      }
      return text(res);
    }

    case "browser_get_dom": {
      await ensureExtensionReady();
      const dom = await callExtension("get_dom");
      return text(dom);
    }

    case "browser_clear_tags": {
      await ensureExtensionReady();
      const res = await callExtension("clear_tags");
      return text(res);
    }

    case "browser_detect_challenge": {
      await ensureExtensionReady();
      const res = await callExtension("detect_challenge");
      if (res && res.challenged) {
        return text({
          challenged: true,
          type: res.type,
          message: `A ${res.type} challenge is on screen. Ask the user to complete it; automation resumes afterwards.`
        });
      }
      return text({ challenged: false });
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// --- MCP stdio transport ------------------------------------------------------

function send(message) {
  process.stdout.write(JSON.stringify(message) + "\n");
}

function sendResult(id, result) {
  send({ jsonrpc: "2.0", id, result });
}

function sendError(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

async function handleMessage(msg) {
  const { id, method, params } = msg;

  // Notifications carry no id and expect no response.
  if (id === undefined) {
    if (method === "notifications/initialized") log("client initialized");
    return;
  }

  try {
    switch (method) {
      case "initialize":
        return sendResult(id, {
          protocolVersion: params?.protocolVersion || "2024-11-05",
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "browser-bridge", version: "2.0.0" }
        });

      case "ping":
        return sendResult(id, {});

      case "tools/list":
        return sendResult(id, { tools: TOOLS });

      case "tools/call": {
        const toolName = params?.name;
        const args = params?.arguments || {};
        if (!toolName) return sendError(id, -32602, "params.name is required");
        try {
          const result = await runTool(toolName, args);
          return sendResult(id, result);
        } catch (err) {
          // Tool-level failures are reported in-band so the model can recover.
          return sendResult(id, {
            content: [{ type: "text", text: `Error: ${err.message}` }],
            isError: true
          });
        }
      }

      default:
        return sendError(id, -32601, `Method not found: ${method}`);
    }
  } catch (err) {
    return sendError(id, -32603, err.message || "Internal error");
  }
}

let stdinBuffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  stdinBuffer += chunk;
  let newlineIndex;
  while ((newlineIndex = stdinBuffer.indexOf("\n")) !== -1) {
    const line = stdinBuffer.slice(0, newlineIndex).trim();
    stdinBuffer = stdinBuffer.slice(newlineIndex + 1);
    if (!line) continue;
    try {
      handleMessage(JSON.parse(line));
    } catch (err) {
      log(`failed to parse message: ${err.message}`);
    }
  }
});

process.stdin.on("end", () => {
  log("stdin closed, shutting down");
  hub.close();
  process.exit(0);
});

process.on("SIGTERM", () => { hub.close(); process.exit(0); });
process.on("SIGINT", () => { hub.close(); process.exit(0); });

log(`started (pid ${process.pid}, port ${PORT})`);
