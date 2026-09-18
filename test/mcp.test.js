// Test Seam 5: MCP Server Protocol
// Verifies the server WorkBuddy spawns actually speaks MCP correctly:
// initialize handshake, tool discovery, and tool invocation.
//
// Each step waits for the reply it needs instead of reading a shared map on a
// fixed clock. The previous version inspected responses at 400/900/1400/2200/
// 2900ms after spawn; on a loaded machine the initialize reply could miss the
// 900ms mark, and the suite then reported "No response to initialize" for a
// server that was working correctly.
const { spawn } = require("child_process");
const path = require("path");

const TEST_PORT = 8996;
const serverPath = path.resolve(__dirname, "../mcp/server.js");

console.log("Testing MCP Server Protocol...");

const proc = spawn("node", [serverPath], {
  env: { ...process.env, BRIDGE_PORT: String(TEST_PORT) },
  stdio: ["pipe", "pipe", "pipe"]
});

let stderr = "";
proc.stderr.on("data", d => { stderr += d.toString(); });

let stdoutBuffer = "";
const responses = new Map(); // id -> parsed message
let wake = null;             // set while a step is waiting for a reply

proc.stdout.on("data", (chunk) => {
  stdoutBuffer += chunk.toString();
  let idx;
  while ((idx = stdoutBuffer.indexOf("\n")) !== -1) {
    const line = stdoutBuffer.slice(0, idx).trim();
    stdoutBuffer = stdoutBuffer.slice(idx + 1);
    if (!line) continue;
    try {
      const msg = JSON.parse(line);
      if (msg.id !== undefined) {
        responses.set(msg.id, msg);
        if (wake) wake();
      }
    } catch (_) {
      console.error("Non-JSON on stdout (protocol violation):", line.slice(0, 120));
      cleanup(1);
    }
  }
});

function send(msg) {
  proc.stdin.write(JSON.stringify(msg) + "\n");
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

// Resolve as soon as the reply carrying this id arrives. The deadline only
// bounds a genuine hang - it is not what decides when we move on.
function awaitResponse(id, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    if (responses.has(id)) return resolve(responses.get(id));
    const timer = setTimeout(() => {
      wake = null;
      reject(new Error(`timed out after ${timeoutMs}ms waiting for response id ${id}`));
    }, timeoutMs);
    wake = () => {
      if (!responses.has(id)) return;
      clearTimeout(timer);
      wake = null;
      resolve(responses.get(id));
    };
  });
}

async function main() {
  // 1. initialize
  send({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "1.0.0" } }
  });

  const init = await awaitResponse(1);
  if (!init.result) return fail("initialize returned an error: " + JSON.stringify(init.error));
  if (!init.result.serverInfo || init.result.serverInfo.name !== "browser-bridge") {
    return fail("Unexpected serverInfo: " + JSON.stringify(init.result.serverInfo));
  }
  if (!init.result.capabilities || !init.result.capabilities.tools) {
    return fail("Server did not advertise tools capability");
  }
  console.log("initialize handshake OK — server:", init.result.serverInfo.name, "v" + init.result.serverInfo.version);
  console.log("protocolVersion:", init.result.protocolVersion);

  // Acknowledge initialization (notification, no id, no response expected)
  send({ jsonrpc: "2.0", method: "notifications/initialized" });

  // 2. tools/list
  send({ jsonrpc: "2.0", id: 2, method: "tools/list" });

  const list = await awaitResponse(2);
  if (!list.result || !Array.isArray(list.result.tools)) {
    return fail("tools/list did not return a tools array");
  }
  const tools = list.result.tools;
  console.log(`tools/list OK — ${tools.length} tools exposed`);

  // Every tool needs a name, description and object inputSchema.
  for (const t of tools) {
    if (!t.name || !t.description) return fail("Tool missing name/description: " + JSON.stringify(t));
    if (!t.inputSchema || t.inputSchema.type !== "object") {
      return fail(`Tool ${t.name} has an invalid inputSchema`);
    }
  }

  const expected = [
    "browser_status", "browser_list_tabs", "browser_focus_tab", "browser_navigate",
    "browser_tag_elements", "browser_click", "browser_type", "browser_screenshot",
    "browser_get_dom", "browser_clear_tags", "browser_detect_challenge"
  ];
  const names = tools.map(t => t.name);
  const missing = expected.filter(n => !names.includes(n));
  if (missing.length) return fail("Missing expected tools: " + missing.join(", "));
  console.log("All expected browser tools present:");
  console.log("  " + names.join(", "));

  // 3. tools/call — with no extension connected this must fail gracefully
  //    (isError in-band, not a protocol-level crash).
  send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "browser_status", arguments: {} } });

  const call = await awaitResponse(3);
  if (call.error) return fail("tools/call returned a protocol error: " + JSON.stringify(call.error));
  if (!call.result || !Array.isArray(call.result.content)) {
    return fail("tools/call result missing content array");
  }
  const textPart = call.result.content.find(c => c.type === "text");
  if (!textPart) return fail("tools/call returned no text content");
  console.log("tools/call OK — browser_status returned:");
  console.log("  " + textPart.text.replace(/\n/g, "\n  "));

  // 4. Unknown method must produce a JSON-RPC error, not silence.
  send({ jsonrpc: "2.0", id: 4, method: "nonexistent/method" });

  const bad = await awaitResponse(4);
  if (!bad.error || bad.error.code !== -32601) {
    return fail("Unknown method should return -32601, got: " + JSON.stringify(bad));
  }
  console.log("Unknown method correctly rejected with -32601");

  console.log("\nTest Seam 5: MCP Server Protocol passed.\n");
  cleanup(0);
}

// Backstop only: every step above has its own deadline, so this should never be
// the thing that fires.
setTimeout(() => fail("Test timed out"), 30000);

main().catch((err) => fail(err.message));
