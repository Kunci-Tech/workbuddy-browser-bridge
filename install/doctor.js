#!/usr/bin/env node
// Browser Bridge Doctor
// One command that answers: "is this thing actually working?"
//
//   npm run doctor
//
// Checks the whole chain — Node version, project files, MCP registration, the
// MCP server itself, and whether the Chrome extension has dialled in.
//
// Exit code 0 = no failures (warnings are fine). Exit code 1 = something is broken.

const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const { spawn } = require("child_process");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const MCP_ENTRY = path.join(PROJECT_ROOT, "mcp", "server.js");
const CONFIG_PATH = path.join(os.homedir(), ".workbuddy-ai", "mcp.json");
const LIVE_PORT = 8766;   // where the extension dials in
const PROBE_PORT = 8788;  // scratch port for testing the MCP server in isolation

const SERVER_NAME = "browser-bridge";
const EXPECTED_TOOLS = 11;
const MIN_NODE_MAJOR = 18;

// --- Reporting ----------------------------------------------------------------

const useColor = Boolean(process.stdout.isTTY);
const c = (code, s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const green = (s) => c(32, s);
const yellow = (s) => c(33, s);
const red = (s) => c(31, s);
const dim = (s) => c(2, s);
const bold = (s) => c(1, s);

const results = [];
function record(level, name, detail, fix) {
  results.push({ level, name, detail, fix });
}
const pass = (name, detail) => record("pass", name, detail);
const warn = (name, detail, fix) => record("warn", name, detail, fix);
const fail = (name, detail, fix) => record("fail", name, detail, fix);

// --- Individual checks --------------------------------------------------------

function checkNode() {
  const major = parseInt(process.versions.node.split(".")[0], 10);
  if (major >= MIN_NODE_MAJOR) {
    pass("Node.js", `v${process.versions.node}`);
  } else {
    fail(
      "Node.js",
      `v${process.versions.node} is too old (need >= ${MIN_NODE_MAJOR})`,
      "Install a newer Node from https://nodejs.org, then run this again."
    );
  }
}

function checkProjectFiles() {
  const required = [
    "manifest.json",
    "background.js",
    "content.js",
    "content.css",
    "popup.html",
    "mcp/server.js",
    "bridge/ws-hub.js",
    "agents/registry.js"
  ];
  const missing = required.filter((f) => !fs.existsSync(path.join(PROJECT_ROOT, f)));
  if (missing.length === 0) {
    pass("Project files", `${required.length} core files present`);
  } else {
    fail(
      "Project files",
      `missing: ${missing.join(", ")}`,
      "You may be running the doctor from a partial copy. Re-clone the repository."
    );
  }
}

function checkMcpRegistration() {
  if (!fs.existsSync(CONFIG_PATH)) {
    fail(
      "MCP registration",
      `no config at ${CONFIG_PATH}`,
      "Run: npm run install-mcp"
    );
    return;
  }

  let config;
  try {
    const raw = fs.readFileSync(CONFIG_PATH, "utf8").trim();
    config = raw ? JSON.parse(raw) : {};
  } catch (err) {
    fail(
      "MCP registration",
      `${CONFIG_PATH} is not valid JSON (${err.message})`,
      "Fix or delete the file, then run: npm run install-mcp"
    );
    return;
  }

  const entry = config.mcpServers?.[SERVER_NAME];
  if (!entry) {
    const others = Object.keys(config.mcpServers || {});
    fail(
      "MCP registration",
      `"${SERVER_NAME}" not found in mcpServers${others.length ? ` (has: ${others.join(", ")})` : ""}`,
      "Run: npm run install-mcp"
    );
    return;
  }

  // The args path must point at a file that actually exists — this catches the
  // "moved the folder after installing" case, which is the most common breakage.
  const argsPath = (entry.args || []).find((a) => typeof a === "string" && a.endsWith(".js"));
  if (!argsPath) {
    fail(
      "MCP registration",
      `entry has no .js path in args`,
      "Run: npm run install-mcp"
    );
    return;
  }

  if (!fs.existsSync(argsPath)) {
    fail(
      "MCP registration",
      `registered path does not exist: ${argsPath}`,
      "The project was moved after installing. Re-run: npm run install-mcp"
    );
    return;
  }

  if (path.resolve(argsPath) !== path.resolve(MCP_ENTRY)) {
    warn(
      "MCP registration",
      `registered path differs from this checkout:\n      registered: ${argsPath}\n      this copy:  ${MCP_ENTRY}`,
      "If you meant to use this copy, re-run: npm run install-mcp"
    );
    return;
  }

  pass("MCP registration", `${SERVER_NAME} -> ${argsPath}`);
}

function checkRegistryDrift() {
  // background.js inlines a copy of the agent ports (service workers can't import
  // the registry). Warn if the two drift apart.
  try {
    const registry = require(path.join(PROJECT_ROOT, "agents", "registry.js"));
    const bg = fs.readFileSync(path.join(PROJECT_ROOT, "background.js"), "utf8");
    const portsInBg = new Set([...bg.matchAll(/port:\s*(\d+)/g)].map((m) => Number(m[1])));
    const missing = Object.values(registry.AGENTS)
      .filter((a) => !portsInBg.has(a.port))
      .map((a) => `${a.id} (${a.port})`);

    if (missing.length === 0) {
      pass("Agent registry", `${Object.keys(registry.AGENTS).length} agents, ports in sync with background.js`);
    } else {
      warn(
        "Agent registry",
        `ports present in registry.js but not background.js: ${missing.join(", ")}`,
        "Add a matching entry to the AGENTS map in background.js."
      );
    }
  } catch (err) {
    warn("Agent registry", `could not verify: ${err.message}`, null);
  }
}

// Spawn the MCP server on a scratch port and drive a real MCP handshake.
function probeMcpServer() {
  return new Promise((resolve) => {
    let proc;
    try {
      proc = spawn(process.execPath, [MCP_ENTRY], {
        env: { ...process.env, BRIDGE_PORT: String(PROBE_PORT) },
        stdio: ["pipe", "pipe", "pipe"]
      });
    } catch (err) {
      return resolve({ ok: false, error: err.message });
    }

    let stderr = "";
    let buf = "";
    let askedList = false;
    let settled = false;
    const seen = new Map();

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { proc.kill("SIGTERM"); } catch (_) {}
      resolve(result);
    };

    const timer = setTimeout(
      () => finish({ ok: false, error: "timed out waiting for a response", stderr }),
      7000
    );

    proc.stderr.on("data", (d) => { stderr += d.toString(); });

    proc.stdout.on("data", (chunk) => {
      buf += chunk.toString();
      let idx;
      while ((idx = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line) continue;

        let msg;
        try {
          msg = JSON.parse(line);
        } catch (_) {
          return finish({ ok: false, error: "non-JSON on stdout (protocol violation)", stderr });
        }
        if (msg.id !== undefined) seen.set(msg.id, msg);
      }

      if (seen.has(1) && !askedList) {
        askedList = true;
        proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }) + "\n");
      }

      if (seen.has(2)) {
        const init = seen.get(1);
        const list = seen.get(2);
        finish({
          ok: true,
          serverName: init.result?.serverInfo?.name,
          version: init.result?.serverInfo?.version,
          tools: (list.result?.tools || []).map((t) => t.name)
        });
      }
    });

    proc.on("error", (err) => finish({ ok: false, error: err.message, stderr }));

    proc.stdin.write(JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "doctor", version: "1.0.0" }
      }
    }) + "\n");
  });
}

function httpGetStatus(port) {
  return new Promise((resolve) => {
    const req = http.get(
      { hostname: "127.0.0.1", port, path: "/status", timeout: 1500 },
      (res) => {
        let data = "";
        res.on("data", (c2) => { data += c2; });
        res.on("end", () => {
          try {
            resolve({ reachable: true, ...JSON.parse(data) });
          } catch (_) {
            resolve({ reachable: true });
          }
        });
      }
    );
    req.on("error", () => resolve({ reachable: false }));
    req.on("timeout", () => { req.destroy(); resolve({ reachable: false }); });
  });
}

// --- Main ---------------------------------------------------------------------

async function main() {
  console.log("");
  console.log(bold("Browser Bridge — install check"));
  console.log(dim(`  project  ${PROJECT_ROOT}`));
  console.log(dim(`  node     ${process.execPath}`));
  console.log("");

  checkNode();
  checkProjectFiles();
  checkMcpRegistration();
  checkRegistryDrift();

  // Does the MCP server actually speak MCP?
  const probe = await probeMcpServer();
  if (!probe.ok) {
    fail(
      "MCP server",
      probe.error,
      "Run it by hand to see stderr: node mcp/server.js"
    );
    if (probe.stderr) {
      console.log(dim("  server stderr:"));
      probe.stderr.trim().split("\n").slice(0, 8).forEach((l) => console.log(dim(`    ${l}`)));
      console.log("");
    }
  } else if (probe.serverName !== SERVER_NAME) {
    fail(
      "MCP server",
      `unexpected server name "${probe.serverName}"`,
      "Check mcp/server.js serverInfo."
    );
  } else if (probe.tools.length !== EXPECTED_TOOLS) {
    warn(
      "MCP server",
      `${probe.serverName} v${probe.version} exposes ${probe.tools.length} tools (expected ${EXPECTED_TOOLS})`,
      null
    );
  } else {
    pass("MCP server", `${probe.serverName} v${probe.version} — ${probe.tools.length} tools, handshake OK`);
  }

  // Is a live bridge running, and has Chrome dialled in?
  const status = await httpGetStatus(LIVE_PORT);
  if (!status.reachable) {
    warn(
      "Live bridge",
      `nothing listening on port ${LIVE_PORT}`,
      "Expected before first use — WorkBuddy spawns it once the MCP server is trusted."
    );
    warn(
      "Chrome extension",
      "not connected (no bridge to connect to)",
      "Load the extension: chrome://extensions -> Developer mode -> Load unpacked."
    );
  } else if (status.connected) {
    pass("Live bridge", `port ${LIVE_PORT}, mode direct`);
    pass("Chrome extension", "connected");
  } else {
    pass("Live bridge", `port ${LIVE_PORT} reachable`);
    warn(
      "Chrome extension",
      "bridge is up but no extension has connected",
      "Open Chrome with the extension loaded, then refresh the page you want to automate."
    );
  }

  // --- Report ---
  console.log("");
  for (const r of results) {
    const mark = r.level === "pass" ? green("PASS") : r.level === "warn" ? yellow("WARN") : red("FAIL");
    console.log(`  ${mark}  ${r.name.padEnd(18)} ${r.detail}`);
    if (r.fix && r.level !== "pass") {
      console.log(`        ${dim(`-> ${r.fix}`)}`);
    }
  }

  const passed = results.filter((r) => r.level === "pass").length;
  const warned = results.filter((r) => r.level === "warn").length;
  const failed = results.filter((r) => r.level === "fail").length;

  console.log("");
  console.log(`  ${passed} passed · ${warned} warnings · ${failed} failures`);
  console.log("");

  if (failed > 0) {
    console.log(red("  Something is broken. Fix the FAIL items above and re-run."));
    console.log("");
    process.exit(1);
  }

  if (warned > 0) {
    console.log(yellow("  Nothing broken.") + " The warnings are the two manual steps:");
    console.log("    1. Trust the MCP server in WorkBuddy (connector management -> custom connectors -> Trust).");
    console.log("    2. Load the extension in Chrome (chrome://extensions -> Load unpacked).");
    console.log("");
    console.log(dim("  Then re-run this to confirm the extension connects."));
  } else {
    console.log(green("  All good. Ask your agent to browse."));
  }
  console.log("");

  process.exit(0);
}

main().catch((err) => {
  console.error(red(`Doctor crashed: ${err.message}`));
  process.exit(1);
});
