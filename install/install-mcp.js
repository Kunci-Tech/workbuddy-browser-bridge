#!/usr/bin/env node
// Installs the Browser Bridge MCP server into WorkBuddy's MCP config.
//
// After this runs once, WorkBuddy starts the bridge automatically whenever it
// needs browser tools — no terminal, no background process to babysit.
//
//   node install/install-mcp.js
//
// Existing MCP servers in the config are preserved.

const fs = require("fs");
const os = require("os");
const path = require("path");

const SERVER_NAME = "browser-bridge";
const PROJECT_ROOT = path.resolve(__dirname, "..");
const MCP_ENTRY = path.join(PROJECT_ROOT, "mcp", "server.js");

// Prefer an explicitly provided node, else the one running this script.
const NODE_BIN = process.env.BRIDGE_NODE || process.execPath;

const CONFIG_DIR = path.join(os.homedir(), ".workbuddy-ai");
const CONFIG_PATH = path.join(CONFIG_DIR, "mcp.json");

function main() {
  if (!fs.existsSync(MCP_ENTRY)) {
    console.error(`Cannot find the MCP server at ${MCP_ENTRY}`);
    process.exit(1);
  }

  // Read the existing config, tolerating a missing or malformed file.
  let config = { mcpServers: {} };
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      const raw = fs.readFileSync(CONFIG_PATH, "utf8").trim();
      if (raw) {
        const parsed = JSON.parse(raw);
        config = parsed && typeof parsed === "object" ? parsed : config;
      }
    } catch (err) {
      console.error(`Existing mcp.json is not valid JSON (${err.message}).`);
      console.error(`Fix or remove ${CONFIG_PATH}, then run this again.`);
      process.exit(1);
    }
  }

  if (!config.mcpServers || typeof config.mcpServers !== "object") {
    config.mcpServers = {};
  }

  const existing = config.mcpServers[SERVER_NAME];
  config.mcpServers[SERVER_NAME] = {
    command: NODE_BIN,
    args: [MCP_ENTRY],
    runtime: { type: "node", version: ">=18" }
  };

  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n", "utf8");

  console.log("");
  console.log("Browser Bridge MCP server installed.");
  console.log("");
  console.log(`  config   ${CONFIG_PATH}`);
  console.log(`  command  ${NODE_BIN}`);
  console.log(`  args     ${MCP_ENTRY}`);
  console.log(`  status   ${existing ? "updated (was already present)" : "added"}`);
  console.log("");
  console.log("Next steps:");
  console.log("  1. Open WorkBuddy and go to the connector management page.");
  console.log("  2. Find the custom connectors entry at the top-right.");
  console.log(`  3. Click \"Trust\" on the \"${SERVER_NAME}\" server to enable it.`);
  console.log("  4. Load the Chrome extension (chrome://extensions -> Load unpacked).");
  console.log("");
  console.log("Then just ask WorkBuddy to browse — it starts the server itself.");
  console.log("");
}

main();
