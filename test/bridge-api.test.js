// Test Seam 2: Bridge Server HTTP API
const { spawn } = require("child_process");
const http = require("http");
const path = require("path");
const { waitForPort } = require("./lib/wait-for-server");

const TEST_PORT = 8999;
const serverPath = path.resolve(__dirname, "../bridge/server.js");

console.log("Testing Bridge Server HTTP API on port", TEST_PORT);

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
  console.error("Failed to start server process:", err.message);
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
    console.error("Test timed out waiting for server response");
    cleanup(1);
  }, 4000);

  const req = http.get(`http://127.0.0.1:${TEST_PORT}/status`, (res) => {
    let rawData = "";
    res.on("data", chunk => rawData += chunk);
    res.on("end", () => {
      try {
        if (res.statusCode !== 200) {
          throw new Error(`Expected HTTP 200, received ${res.statusCode}: ${rawData}`);
        }
        const parsed = JSON.parse(rawData);
        if (parsed.port !== TEST_PORT) {
          throw new Error(`Expected port ${TEST_PORT}, received ${parsed.port}`);
        }
        if (typeof parsed.connected !== "boolean") {
          throw new Error(`Expected boolean 'connected' field, received ${parsed.connected}`);
        }
        if (!parsed.agents) {
          throw new Error("Expected 'agents' field in status response");
        }

        console.log("Bridge Server /status responded:", JSON.stringify(parsed));
        console.log("Test Seam 2: Bridge Server API passed.\n");
        cleanup(0);
      } catch (err) {
        console.error("API Assertion Error:", err.message);
        console.error("Server output:\n", serverOutput);
        cleanup(1);
      }
    });
  });

  req.on("error", (err) => {
    console.error("HTTP Request to bridge failed:", err.message);
    console.error("Server output:\n", serverOutput);
    cleanup(1);
  });
});
