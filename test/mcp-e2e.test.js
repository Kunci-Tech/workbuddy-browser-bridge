// Test Seam 6: End-to-end MCP -> WebSocket -> extension round trip.
// Spawns the MCP server, connects a fake "extension" over WebSocket, then drives
// it through MCP tool calls and checks the results survive the whole chain.
//
// Event-driven: each step awaits its own response instead of racing fixed timers.
const { spawn } = require("child_process");
const path = require("path");

const TEST_PORT = 8995;
const serverPath = path.resolve(__dirname, "../mcp/server.js");

console.log("Testing end-to-end MCP -> extension round trip...");

const proc = spawn("node", [serverPath], {
  env: { ...process.env, BRIDGE_PORT: String(TEST_PORT) },
  stdio: ["pipe", "pipe", "pipe"]
});

let stderr = "";
proc.stderr.on("data", d => { stderr += d.toString(); });

// --- MCP client plumbing ------------------------------------------------------

const pending = new Map();
let nextId = 1;
let stdoutBuffer = "";

proc.stdout.on("data", (chunk) => {
  stdoutBuffer += chunk.toString();
  let idx;
  while ((idx = stdoutBuffer.indexOf("\n")) !== -1) {
    const line = stdoutBuffer.slice(0, idx).trim();
    stdoutBuffer = stdoutBuffer.slice(idx + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch (_) { return; }
    if (msg.id !== undefined && pending.has(msg.id)) {
      const { resolve, timer } = pending.get(msg.id);
      clearTimeout(timer);
      pending.delete(msg.id);
      resolve(msg);
    }
  }
});

function mcpSend(msg) {
  proc.stdin.write(JSON.stringify(msg) + "\n");
}

function callMcp(method, params, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`timed out waiting for ${method}`));
    }, timeoutMs);
    pending.set(id, { resolve, timer });
    mcpSend({ jsonrpc: "2.0", id, method, params });
  });
}

function cleanup(code) {
  try { proc.kill("SIGTERM"); } catch (_) {}
  process.exit(code);
}

function fail(msg) {
  console.error("FAILED:", msg);
  if (stderr) console.error("Server stderr:\n", stderr);
  cleanup(1);
}

proc.on("error", (err) => fail("Failed to start MCP server: " + err.message));

// Extract the text payload from a tools/call result.
function resultText(res) {
  if (res.error) throw new Error("protocol error: " + JSON.stringify(res.error));
  if (res.result?.isError) throw new Error(res.result.content?.[0]?.text || "tool error");
  const part = res.result?.content?.find(c => c.type === "text");
  if (!part) throw new Error("no text content in result");
  return part.text;
}

// --- Fake Chrome extension ----------------------------------------------------
// Mimics background.js: dials out, registers, answers commands.

const FAKE_TABS = [
  { id: 1, windowId: 1, title: "Google Ads - Campaigns", url: "https://ads.google.com/aw/campaigns", active: true },
  { id: 2, windowId: 1, title: "Analytics", url: "https://analytics.google.com", active: false }
];

function connectFakeExtension() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${TEST_PORT}/ws/workbuddy`);

    const timer = setTimeout(() => reject(new Error("fake extension connect timeout")), 4000);

    ws.onopen = () => {
      ws.send(JSON.stringify({
        type: "REGISTER",
        client: "Fake Chrome Extension (test)",
        agent: "workbuddy",
        version: "2.0.0"
      }));
      clearTimeout(timer);
      // Small settle so the hub records the socket before we issue commands.
      setTimeout(resolve, 150);
    };

    ws.onmessage = (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch (_) { return; }
      if (msg.type === "PONG") return;
      if (!msg.command) return;

      let result = null;
      try {
        switch (msg.command) {
          case "list_tabs":
            result = FAKE_TABS;
            break;
          case "tag_elements":
            result = {
              taggedCount: 2,
              elements: [
                { badgeId: 1, tag: "button", text: "Save", x: 100, y: 200 },
                { badgeId: 2, tag: "a", text: "Reports", x: 300, y: 200 }
              ]
            };
            break;
          case "click_badge":
            result = { clicked: true, x: 100, y: 200, label: `Click Badge [${msg.params.badgeId}]` };
            break;
          case "detect_challenge":
            result = { challenged: false };
            break;
          default:
            ws.send(JSON.stringify({ id: msg.id, success: false, error: `not implemented: ${msg.command}` }));
            return;
        }
      } catch (err) {
        ws.send(JSON.stringify({ id: msg.id, success: false, error: err.message }));
        return;
      }

      ws.send(JSON.stringify({ id: msg.id, success: true, result }));
    };

    ws.onerror = () => { clearTimeout(timer); reject(new Error("fake extension could not connect")); };
  });
}

// --- Run ----------------------------------------------------------------------

async function main() {
  const init = await callMcp("initialize", {
    protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "e2e", version: "1.0.0" }
  });
  if (!init.result || init.result.serverInfo?.name !== "browser-bridge") {
    throw new Error("bad initialize response: " + JSON.stringify(init));
  }
  console.log(`initialize OK — ${init.result.serverInfo.name} v${init.result.serverInfo.version}`);
  mcpSend({ jsonrpc: "2.0", method: "notifications/initialized" });

  await connectFakeExtension();
  console.log("Fake extension connected and registered");

  // 1. Status should now report connected.
  const statusRes = await callMcp("tools/call", { name: "browser_status", arguments: {} });
  const status = JSON.parse(resultText(statusRes));
  if (status.connected !== true) {
    throw new Error("browser_status should be connected:true, got " + JSON.stringify(status));
  }
  console.log(`browser_status -> connected: ${status.connected} (mode: ${status.mode})`);

  // 2. Real data over the full chain.
  const tabsRes = await callMcp("tools/call", { name: "browser_list_tabs", arguments: {} });
  const tabs = JSON.parse(resultText(tabsRes));
  if (!Array.isArray(tabs) || tabs.length !== FAKE_TABS.length) {
    throw new Error("unexpected tabs: " + JSON.stringify(tabs));
  }
  if (tabs[0].title !== "Google Ads - Campaigns") {
    throw new Error("tab title corrupted in transit: " + tabs[0].title);
  }
  console.log(`browser_list_tabs -> ${tabs.length} tabs`);
  tabs.forEach(t => console.log(`  [${t.id}] ${t.title}`));

  // 3. Set-of-Mark tagging.
  const tagRes = await callMcp("tools/call", { name: "browser_tag_elements", arguments: {} });
  const tags = JSON.parse(resultText(tagRes));
  if (tags.taggedCount !== 2) throw new Error("expected 2 tags, got " + JSON.stringify(tags));
  console.log(`browser_tag_elements -> ${tags.taggedCount} badges (ids ${tags.elements.map(e => e.badgeId).join(", ")})`);

  // 4. Click by badge.
  const clickRes = await callMcp("tools/call", {
    name: "browser_click", arguments: { badgeId: 1, actionLabel: "Clicking Save" }
  });
  const click = JSON.parse(resultText(clickRes));
  if (!click.clicked) throw new Error("click did not report success: " + JSON.stringify(click));
  console.log(`browser_click { badgeId: 1 } -> ${click.label}`);

  // 5. A tool error must come back in-band, not crash the server.
  const errRes = await callMcp("tools/call", { name: "browser_get_dom", arguments: {} });
  if (!errRes.result?.isError) {
    throw new Error("expected in-band isError for an unimplemented command");
  }
  console.log("unimplemented command surfaced as in-band error (server stayed up)");

  console.log("\nTest Seam 6: End-to-end MCP round trip passed.\n");
  cleanup(0);
}

main().catch((err) => fail(err.message));
