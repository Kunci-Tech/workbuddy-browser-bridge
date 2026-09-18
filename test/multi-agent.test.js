// Test Seam 4: Multi-Agent Registry & Routing
const { spawn } = require("child_process");
const http = require("http");
const path = require("path");
const { waitForPort } = require("./lib/wait-for-server");

const TEST_PORT = 8997;
const serverPath = path.resolve(__dirname, "../bridge/server.js");

console.log("Testing Multi-Agent Registry & Routing...");

const serverProcess = spawn("node", [serverPath], {
  env: { ...process.env, BRIDGE_PORT: String(TEST_PORT) },
  stdio: "pipe"
});

let serverOutput = "";
serverProcess.stdout.on("data", data => { serverOutput += data.toString(); });
serverProcess.stderr.on("data", data => { serverOutput += data.toString(); });

function cleanup(code) {
  try { serverProcess.kill("SIGTERM"); } catch (_) {}
  process.exit(code);
}

serverProcess.on("error", (err) => {
  console.error("Failed to start server:", err.message);
  cleanup(1);
});

// Wait for the child to bind the port instead of guessing with a sleep. A fixed
// delay turns "this machine was busy for 600ms" into "the server is broken",
// because a refused connection looks exactly like a real regression.
waitForPort(TEST_PORT).then((ready) => {
  if (!ready) {
    console.error(`Bridge server never listened on port ${TEST_PORT}`);
    console.error("Server output:\n", serverOutput);
    return cleanup(1);
  }

  // Startup is proven, so the watchdog now measures the requests only.
  setTimeout(() => {
    console.error("Test timed out");
    cleanup(1);
  }, 5000);

  // 1. Test /agents endpoint
  http.get(`http://127.0.0.1:${TEST_PORT}/agents`, (res) => {
    let data = "";
    res.on("data", chunk => data += chunk);
    res.on("end", () => {
      try {
        if (res.statusCode !== 200) throw new Error(`HTTP ${res.statusCode}: ${data}`);
        const parsed = JSON.parse(data);
        if (!parsed.agents || !Array.isArray(parsed.agents)) {
          throw new Error("Expected 'agents' array in response");
        }
        const hasWorkbuddy = parsed.agents.some(a => a.id === "workbuddy");
        const hasAntigravity = parsed.agents.some(a => a.id === "antigravity");
        if (!hasWorkbuddy) throw new Error("Registry must include 'workbuddy' agent");
        if (!hasAntigravity) throw new Error("Registry must include 'antigravity' agent");

        console.log(`Agents endpoint: found ${parsed.agents.length} agents`);
        parsed.agents.forEach(a => {
          console.log(`  - ${a.name} (port ${a.port}, connected=${a.connected})`);
        });

        // 2. Test /system-prompt endpoint
        http.get(`http://127.0.0.1:${TEST_PORT}/system-prompt`, (res2) => {
          let data2 = "";
          res2.on("data", chunk => data2 += chunk);
          res2.on("end", () => {
            try {
              if (res2.statusCode !== 200) throw new Error(`HTTP ${res2.statusCode}: ${data2}`);
              const parsed2 = JSON.parse(data2);
              if (!parsed2.systemPrompt) throw new Error("Expected 'systemPrompt' in response");
              if (!parsed2.guide) throw new Error("Expected 'guide' in response");
              if (!Array.isArray(parsed2.capabilities)) throw new Error("Expected 'capabilities' array");

              console.log("System prompt endpoint verified for agent:", parsed2.agentName);
              console.log(`  Prompt length: ${parsed2.systemPrompt.length} chars`);
              console.log(`  Capabilities: ${parsed2.capabilities.join(", ")}`);
              console.log(`  Guide examples: ${parsed2.guide.examples.length}`);

              // 3. Test agent-specific system prompt via header
              const req3 = http.request({
                hostname: "127.0.0.1",
                port: TEST_PORT,
                path: "/system-prompt",
                method: "GET",
                headers: { "X-Agent-Id": "antigravity" }
              }, (res3) => {
                let data3 = "";
                res3.on("data", chunk => data3 += chunk);
                res3.on("end", () => {
                  try {
                    const parsed3 = JSON.parse(data3);
                    if (parsed3.agentId !== "antigravity") {
                      throw new Error(`Expected agentId 'antigravity', got '${parsed3.agentId}'`);
                    }
                    console.log("Agent routing via X-Agent-Id header verified:", parsed3.agentId);

                    console.log("\nTest Seam 4: Multi-Agent Registry passed.\n");
                    cleanup(0);
                  } catch (e) {
                    console.error("Agent routing test failed:", e.message);
                    cleanup(1);
                  }
                });
              });
              req3.on("error", (e) => { console.error(e.message); cleanup(1); });
              req3.end();
            } catch (e) {
              console.error("System prompt test failed:", e.message);
              cleanup(1);
            }
          });
        }).on("error", (e) => { console.error(e.message); cleanup(1); });
      } catch (e) {
        console.error("Agents endpoint test failed:", e.message);
        console.error("Server output:\n", serverOutput);
        cleanup(1);
      }
    });
  }).on("error", (err) => {
    console.error("HTTP request failed:", err.message);
    console.error("Server output:\n", serverOutput);
    cleanup(1);
  });
});
