// Browser Bridge — Standalone Server (HTTP REST + WebSocket)
//
// Use this for Antigravity, for manual/debug use, or any agent that talks REST
// instead of MCP. For WorkBuddy the MCP server (mcp/server.js) is spawned
// automatically, so you never need to run this by hand.
//
//   npm start              -> binds every agent port (8765 + 8766)
//   BRIDGE_PORT=9000 npm start -> binds only 9000
//
// Zero dependencies.

const path = require("path");

const { createHub } = require("./ws-hub.js");
const { createRouteHandler } = require("./routes.js");
const { AGENTS } = require(path.join(__dirname, "..", "agents", "registry.js"));

const FORCED_PORT = process.env.BRIDGE_PORT ? parseInt(process.env.BRIDGE_PORT, 10) : null;
const DEFAULT_AGENT_ID = "workbuddy";

const hubs = {}; // agentId -> hub

function log(...args) {
  console.log(...args);
}

// --- Build one hub per agent port --------------------------------------------

const targets = FORCED_PORT
  ? [[DEFAULT_AGENT_ID, { ...AGENTS[DEFAULT_AGENT_ID], port: FORCED_PORT }]]
  : Object.entries(AGENTS);

// A facade so the shared route handler sees a single, unified view even though
// each agent listens on its own port.
const combined = {
  defaultAgentId: DEFAULT_AGENT_ID,
  isConnected: (agentId) => Boolean(hubs[agentId] && hubs[agentId].isConnected(agentId)),
  connectedAgents: () =>
    Object.fromEntries(Object.keys(AGENTS).map(id => [id, Boolean(hubs[id] && hubs[id].isConnected(id))])),
  executeOnExtension: (command, params, agentId) => {
    const hub = hubs[agentId] || hubs[DEFAULT_AGENT_ID];
    if (!hub) {
      return Promise.reject(new Error(`No bridge listening for agent "${agentId}".`));
    }
    return hub.executeOnExtension(command, params, agentId);
  }
};

const routeHandler = createRouteHandler({ agents: AGENTS, hub: combined, logger: { log, error: console.error } });

for (const [agentId, agent] of targets) {
  const hub = createHub({
    port: agent.port,
    defaultAgentId: agentId,
    requestHandler: routeHandler,
    logger: { log, error: console.error }
  });

  hub.server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      log(`[Bridge] Port ${agent.port} is already in use — skipping ${agent.name}.`);
      log(`[Bridge] That's fine if the MCP server or another bridge is already serving it.`);
    } else {
      console.error(`[Bridge] Server error on port ${agent.port}:`, err.message);
    }
  });

  hub.listen(() => {
    log(`[Bridge] ${agent.name} listening on http://127.0.0.1:${agent.port}`);
  });

  hubs[agentId] = hub;
}

log(`====================================================`);
log(`Browser Bridge Server Running`);
log(`Agents: ${Object.keys(AGENTS).join(", ")}`);
log(`Tip: for WorkBuddy you don't need this — it starts the MCP server itself.`);
log(`====================================================`);
