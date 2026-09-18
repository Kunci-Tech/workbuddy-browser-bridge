// Browser Bridge Client Library
// High-level API for WorkBuddy AI, Antigravity IDE, and other agents to control Chrome

const http = require("http");
const path = require("path");

// Load agent registry
const { AGENTS, DEFAULT_AGENT, getAgent } = require(path.join(__dirname, "..", "agents", "registry.js"));

// Default to WorkBuddy agent
let activeAgent = DEFAULT_AGENT;

function setAgent(agentId) {
  if (AGENTS[agentId]) {
    activeAgent = agentId;
    return true;
  }
  return false;
}

function getBaseUrl() {
  const agent = AGENTS[activeAgent];
  const port = process.env.BRIDGE_PORT ? parseInt(process.env.BRIDGE_PORT, 10) : agent.port;
  return `http://127.0.0.1:${port}`;
}

function request(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const baseUrl = getBaseUrl();
    const url = new URL(path, baseUrl);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: method,
      headers: {
        "Content-Type": "application/json",
        "X-Agent-Id": activeAgent
      }
    };

    const req = http.request(options, (res) => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(json);
          } else {
            reject(new Error(json.error || `HTTP ${res.statusCode}: ${data}`));
          }
        } catch (e) {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(data);
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${data}`));
          }
        }
      });
    });

    req.on("error", (err) => {
      reject(new Error(`Could not connect to Browser Bridge at ${baseUrl}. Is bridge/server.js running? Details: ${err.message}`));
    });

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

const browser = {
  // Agent management
  setAgent,
  getActiveAgent: () => activeAgent,
  getAgents: () => Object.keys(AGENTS),

  // Agent info and system prompt
  async getAgentInfo() {
    return await request("GET", "/agents");
  },

  async getSystemPrompt() {
    return await request("GET", "/system-prompt");
  },

  // Status
  async getStatus() {
    return await request("GET", "/status");
  },

  // Tab management
  async getTabs() {
    return await request("GET", "/tabs");
  },

  async focusTab(query = {}) {
    if (typeof query === "number") query = { tabId: query };
    if (typeof query === "string") {
      query = query.startsWith("http") ? { urlContains: query } : { titleContains: query };
    }
    return await request("POST", "/tab/focus", query);
  },

  async navigate(url, tabId = undefined) {
    return await request("POST", "/navigate", { url, tabId });
  },

  // Interaction
  async click(options = {}) {
    return await request("POST", "/click", options);
  },

  async type(text, tabId = undefined) {
    const payload = typeof text === "string" ? { text, tabId } : text;
    return await request("POST", "/type", payload);
  },

  async getDOM(tabId = undefined) {
    return await request("POST", "/dom", { tabId });
  },

  async screenshot(options = {}) {
    return await request("POST", "/screenshot", options);
  },

  async evaluate(code, tabId = undefined) {
    const payload = typeof code === "string" ? { code, tabId } : code;
    const res = await request("POST", "/eval", payload);
    return res.result;
  },

  // Set-of-Mark
  async tagElements(tabId = undefined) {
    return await request("POST", "/tags/create", { tabId });
  },

  async clearTags(tabId = undefined) {
    return await request("POST", "/tags/clear", { tabId });
  },

  async clickBadge(badgeId, options = {}) {
    const payload = typeof options === "string" ? { actionLabel: options } : options;
    return await request("POST", "/click/badge", { badgeId, ...payload });
  },

  // Human handshake
  async detectChallenge(tabId = undefined) {
    return await request("POST", "/handshake/detect", { tabId });
  },

  // Omnibar
  async toggleOmnibar(tabId = undefined) {
    return await request("POST", "/omnibar/toggle", { tabId });
  },

  // Macro recorder
  async startRecording(tabId = undefined) {
    return await request("POST", "/record/start", { tabId });
  },

  async stopRecording(tabId = undefined) {
    return await request("POST", "/record/stop", { tabId });
  },

  async getRecipe() {
    return await request("GET", "/record/recipe");
  }
};

module.exports = browser;
