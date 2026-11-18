// Test Seam 3: Advanced Feature API & Client Interface
const { spawn } = require("child_process");
const http = require("http");
const path = require("path");
const browser = require("../bridge/client.js");
const { waitForPort } = require("./lib/wait-for-server");

const TEST_PORT = 8998;
const serverPath = path.resolve(__dirname, "../bridge/server.js");

console.log("Testing Feature API & Client Interface...");

// 1. Verify client methods
const requiredMethods = [
  "tagElements", "clearTags", "clickBadge", "detectChallenge",
  "toggleOmnibar", "startRecording", "stopRecording", "getRecipe",
  "focusTab", "click", "type", "getDOM", "screenshot",
  // New multi-agent methods
  "getAgentInfo", "getSystemPrompt", "setAgent", "getActiveAgent", "getAgents"
];

for (const method of requiredMethods) {
  if (typeof browser[method] !== "function") {
    console.error(`Missing client method: browser.${method}`);
    process.exit(1);
  }
}
console.log(`All ${requiredMethods.length} client library methods verified.`);

// 2. Start server and test endpoints
const serverProcess = spawn("node", [serverPath], {
  env: { ...process.env, BRIDGE_PORT: String(TEST_PORT) },
  stdio: "pipe"
});

function cleanup(code) {
  try { serverProcess.kill("SIGTERM"); } catch (_) {}
  process.exit(code);
}

let serverOutput = "";
serverProcess.stdout.on("data", data => { serverOutput += data.toString(); });
serverProcess.stderr.on("data", data => { serverOutput += data.toString(); });

serverProcess.on("error", (err) => {
  console.error("Failed to start test server:", err.message);
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

  // Startup is proven, so the watchdog now measures the request only.
  setTimeout(() => {
    console.error("Test timed out");
    cleanup(1);
  }, 4000);

  // Test omnibar prompt endpoint
  const postData = JSON.stringify({ prompt: "Navigate to google.com", url: "https://example.com" });
  const req = http.request({
    hostname: "127.0.0.1",
    port: TEST_PORT,
    path: "/omnibar/prompt",
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(postData)
    }
  }, (res) => {
    let data = "";
    res.on("data", chunk => data += chunk);
    res.on("end", () => {
      try {
        if (res.statusCode !== 200) throw new Error(`HTTP ${res.statusCode}: ${data}`);
        const parsed = JSON.parse(data);
        if (!parsed.received || parsed.prompt !== "Navigate to google.com") {
          throw new Error("Invalid response from /omnibar/prompt: " + data);
        }
        console.log("Omnibar Prompt endpoint verified:", JSON.stringify(parsed));
        console.log("Test Seam 3: Advanced Features API passed.\n");
        cleanup(0);
      } catch (e) {
        console.error("Assertion error:", e.message);
        cleanup(1);
      }
    });
  });

  req.on("error", (e) => {
    console.error("HTTP request failed:", e.message);
    console.error("Server output:\n", serverOutput);
    cleanup(1);
  });

  req.write(postData);
  req.end();
});
