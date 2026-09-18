// Shared HTTP route handler for the bridge.
// Used by both bridge/server.js (standalone) and mcp/server.js (MCP mode),
// so the REST surface is identical no matter how the hub is hosted.

function createRouteHandler({ agents, hub, logger = console }) {
  const readBody = (req) => new Promise((resolve) => {
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", () => {
      try { resolve(body ? JSON.parse(body) : {}); } catch (_) { resolve({}); }
    });
  });

  return async function handleRequest(req, res, api) {
    const url = new URL(req.url, `http://127.0.0.1:${api.port}`);
    const pathname = url.pathname;
    const agentId = req.headers["x-agent-id"] || url.searchParams.get("agent") || hub.defaultAgentId;

    const send = (code, payload) => {
      res.writeHead(code);
      res.end(JSON.stringify(payload));
      return true;
    };

    const run = async (command, params) => {
      const result = await hub.executeOnExtension(command, params, agentId);
      return send(200, result);
    };

    // --- Meta ---
    if (req.method === "GET" && pathname === "/status") {
      return send(200, {
        status: "ok",
        connected: hub.isConnected(agentId),
        port: api.port,
        agent: agentId,
        agents: hub.connectedAgents()
      });
    }

    // Generic passthrough — lets a second process (e.g. the MCP server when the
    // port is already taken) drive the extension through an already-running hub.
    if (req.method === "POST" && pathname === "/command") {
      const body = await readBody(req);
      if (!body.command) return send(400, { error: "command is required" });
      const target = body.agentId || agentId;
      const result = await hub.executeOnExtension(body.command, body.params || {}, target);
      return send(200, { result });
    }

    if (req.method === "GET" && pathname === "/agents") {
      return send(200, {
        agents: Object.entries(agents).map(([id, a]) => ({
          id,
          name: a.name,
          port: a.port,
          connected: hub.isConnected(id),
          capabilities: a.capabilities
        }))
      });
    }

    if (req.method === "GET" && pathname === "/system-prompt") {
      const agent = agents[agentId] || agents[hub.defaultAgentId];
      return send(200, {
        agentId: agent.id,
        agentName: agent.name,
        systemPrompt: agent.systemPrompt,
        guide: agent.guide,
        capabilities: agent.capabilities
      });
    }

    // --- Tabs ---
    if (req.method === "GET" && pathname === "/tabs") {
      return run("list_tabs");
    }
    if (req.method === "POST" && pathname === "/tab/focus") {
      return run("focus_tab", await readBody(req));
    }
    if (req.method === "POST" && pathname === "/navigate") {
      return run("navigate", await readBody(req));
    }

    // --- Interaction ---
    if (req.method === "POST" && pathname === "/click") {
      return run("click", await readBody(req));
    }
    if (req.method === "POST" && pathname === "/type") {
      return run("type", await readBody(req));
    }
    if (req.method === "POST" && pathname === "/dom") {
      return run("get_dom", await readBody(req));
    }
    if (req.method === "POST" && pathname === "/screenshot") {
      return run("screenshot", await readBody(req));
    }
    if (req.method === "POST" && pathname === "/eval") {
      const result = await hub.executeOnExtension("eval", await readBody(req), agentId);
      return send(200, { result });
    }

    // --- Set-of-Mark ---
    if (req.method === "POST" && pathname === "/tags/create") {
      return run("tag_elements", await readBody(req));
    }
    if (req.method === "POST" && pathname === "/tags/clear") {
      return run("clear_tags", await readBody(req));
    }
    if (req.method === "POST" && pathname === "/click/badge") {
      return run("click_badge", await readBody(req));
    }

    // --- Human handshake ---
    if (req.method === "POST" && pathname === "/handshake/detect") {
      return run("detect_challenge", await readBody(req));
    }

    // --- Omnibar ---
    if (req.method === "POST" && pathname === "/omnibar/toggle") {
      return run("toggle_omnibar", await readBody(req));
    }
    if (req.method === "POST" && pathname === "/omnibar/prompt") {
      const body = await readBody(req);
      logger.log(`[${agentId} omnibar] ${body.prompt}`);
      return send(200, { received: true, prompt: body.prompt, agent: agentId });
    }

    // --- Macro recorder ---
    if (req.method === "POST" && pathname === "/record/start") {
      return run("start_recording", await readBody(req));
    }
    if (req.method === "POST" && pathname === "/record/stop") {
      return run("stop_recording", await readBody(req));
    }
    if (req.method === "GET" && pathname === "/record/recipe") {
      return run("get_recorded_recipe", {});
    }

    return false;
  };
}

module.exports = { createRouteHandler };
