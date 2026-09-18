// Browser Bridge Background Service Worker
// Agent-agnostic: supports WorkBuddy, Antigravity, and future AI agents
// Multi-agent WebSocket client, CDP controller, event recorder

// Agent registry loaded inline (service workers can't use module imports reliably)
const AGENTS = {
  workbuddy: {
    id: "workbuddy",
    name: "WorkBuddy AI",
    shortName: "WorkBuddy",
    port: 8766,
    wsUrl: "ws://127.0.0.1:8766",
    httpUrl: "http://127.0.0.1:8766",
    branding: {
      primaryColor: "#1D9E75",
      accentGradient: "linear-gradient(135deg, #1D9E75 0%, #5DCAA5 50%, #A0E8C5 100%)",
      dark: "#04342C",
      light: "#E1F5EE"
    }
  },
  antigravity: {
    id: "antigravity",
    name: "Antigravity IDE",
    shortName: "Antigravity",
    port: 8765,
    wsUrl: "ws://127.0.0.1:8765",
    httpUrl: "http://127.0.0.1:8765",
    branding: {
      primaryColor: "#38bdf8",
      accentGradient: "linear-gradient(135deg, #38bdf8 0%, #818cf8 50%, #c084fc 100%)",
      dark: "#0C447C",
      light: "#E6F1FB"
    }
  }
};

const DEFAULT_AGENT_ID = "workbuddy";

// State
let activeAgentId = DEFAULT_AGENT_ID;
let activeAgent = AGENTS[DEFAULT_AGENT_ID];
const wsConnections = {}; // agentId -> WebSocket
const reconnectTimers = {};
const reconnectAttempts = {}; // agentId -> consecutive failed attempts
const serverOnline = {}; // agentId -> boolean, is the bridge server reachable
const warnedOffline = {}; // agentId -> boolean, have we already logged the gentle hint
const attachedTabs = new Set();

// Recording state (shared across agents)
let isRecording = false;
let recordedSteps = [];

// Load saved agent preference from storage
chrome.storage?.local?.get("activeAgentId", (result) => {
  if (result && result.activeAgentId && AGENTS[result.activeAgentId]) {
    setActiveAgent(result.activeAgentId);
  }
});

function setActiveAgent(agentId) {
  if (!AGENTS[agentId]) return;

  const previousAgentId = activeAgentId;
  activeAgentId = agentId;
  activeAgent = AGENTS[agentId];
  chrome.storage?.local?.set({ activeAgentId });

  // Drop the previous agent's socket — we only keep one live connection at a time.
  if (previousAgentId && previousAgentId !== agentId) {
    const prevWs = wsConnections[previousAgentId];
    if (prevWs) {
      try { prevWs.close(); } catch (_) {}
    }
    wsConnections[previousAgentId] = null;
    if (reconnectTimers[previousAgentId]) {
      clearTimeout(reconnectTimers[previousAgentId]);
      reconnectTimers[previousAgentId] = null;
    }
    reconnectAttempts[previousAgentId] = 0;
    warnedOffline[previousAgentId] = false;
  }

  // Connect to the newly selected agent and reflect its live state on the badge.
  connectToBridge(agentId);
  updateBadge(Boolean(wsConnections[agentId] && wsConnections[agentId].readyState === WebSocket.OPEN));

  // Notify content script of agent change
  chrome.tabs?.query({ active: true, currentWindow: true }).then(([tab]) => {
    if (tab) {
      chrome.tabs.sendMessage(tab.id, {
        action: "AGENT_CHANGED",
        agent: activeAgent
      }).catch(() => {});
    }
  });

  console.log(`[Browser Bridge] Active agent: ${activeAgent.name}`);
}

function updateBadge(connected) {
  if (connected) {
    chrome.action.setBadgeText({ text: activeAgent.shortName.slice(0, 3).toUpperCase() });
    chrome.action.setBadgeBackgroundColor({ color: activeAgent.branding.primaryColor });
  } else {
    // Neutral "OFF" state — the server simply isn't running yet, which is not an error.
    chrome.action.setBadgeText({ text: "OFF" });
    chrome.action.setBadgeBackgroundColor({ color: "#64748b" });
  }
}

// Connect to bridge server for a specific agent.
// Only the active agent is ever connected — connecting to every agent would
// spam the console with ERR_CONNECTION_REFUSED for agents the user isn't using.
function connectToBridge(agentId) {
  const agent = AGENTS[agentId];
  if (!agent) return;

  // Only ever hold a connection for the agent the user has selected.
  if (agentId !== activeAgentId) return;

  const existing = wsConnections[agentId];
  if (existing && (existing.readyState === WebSocket.OPEN || existing.readyState === WebSocket.CONNECTING)) {
    return;
  }

  try {
    const ws = new WebSocket(agent.wsUrl);
    let heartbeatTimer = null;

    function startHeartbeat() {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      heartbeatTimer = setInterval(() => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          sendToBridge(agentId, { type: "PING", timestamp: Date.now() });
        }
      }, 10000);
    }

    function stopHeartbeat() {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
    }

    ws.onopen = () => {
      console.log(`[Browser Bridge] Connected to ${agent.name} bridge at ${agent.wsUrl}`);
      reconnectAttempts[agentId] = 0;
      serverOnline[agentId] = true;
      if (agentId === activeAgentId) {
        updateBadge(true);
      }
      startHeartbeat();

      sendToBridge(agentId, {
        type: "REGISTER",
        client: "Browser Bridge Chrome Extension",
        agent: agentId,
        version: "2.0.0",
        timestamp: Date.now()
      });
    };

    ws.onmessage = async (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === "PONG") return;

        const { id, command, params } = message;
        if (!command) return;

        const result = await handleCommand(command, params || {}, agentId);
        sendToBridge(agentId, {
          id,
          success: true,
          result
        });
      } catch (err) {
        console.error(`[Browser Bridge] Command error (${agentId}):`, err);
        try {
          const message = JSON.parse(event.data);
          sendToBridge(agentId, {
            id: message.id,
            success: false,
            error: err.message || String(err)
          });
        } catch (_) {}
      }
    };

    ws.onclose = () => {
      serverOnline[agentId] = false;
      if (agentId === activeAgentId) {
        updateBadge(false);
      }
      stopHeartbeat();
      wsConnections[agentId] = null;
      scheduleReconnect(agentId);
    };

    ws.onerror = () => {
      // A refused connection just means the local bridge server isn't running.
      // This is an expected state (not a failure), so we keep the log quiet and
      // informative rather than alarming.
      serverOnline[agentId] = false;
      if (!warnedOffline[agentId]) {
        warnedOffline[agentId] = true;
        console.info(
          `[Browser Bridge] Waiting for the ${agent.name} bridge server on port ${agent.port}. ` +
          `Start it with: ./start-bridge.sh  (or: npm start)`
        );
      }
      stopHeartbeat();
    };

    wsConnections[agentId] = ws;
  } catch (e) {
    scheduleReconnect(agentId);
  }
}

function scheduleReconnect(agentId) {
  if (reconnectTimers[agentId]) clearTimeout(reconnectTimers[agentId]);

  // Gentle exponential backoff: retry quickly right after load (so starting the
  // server connects almost instantly), then ease off so a server that stays down
  // doesn't flood the DevTools console with connection errors.
  const attempt = (reconnectAttempts[agentId] = (reconnectAttempts[agentId] || 0) + 1);
  const delay = attempt <= 4 ? 2500 : attempt <= 10 ? 5000 : 15000;

  reconnectTimers[agentId] = setTimeout(() => connectToBridge(agentId), delay);
}

// Keep service worker awake
try {
  chrome.alarms.create("bridge-keepalive", { periodInMinutes: 0.25 });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "bridge-keepalive") {
      // Reconnect to active agent if needed
      const ws = wsConnections[activeAgentId];
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        connectToBridge(activeAgentId);
      }
    }
  });
} catch (_) {}

chrome.runtime.onInstalled?.addListener(() => {
  connectToBridge(activeAgentId);
});

chrome.runtime.onStartup?.addListener(() => {
  connectToBridge(activeAgentId);
});

function sendToBridge(agentId, data) {
  const ws = wsConnections[agentId];
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

// --- Chrome Debugger (CDP) Management ---

async function ensureDebuggerAttached(tabId) {
  if (attachedTabs.has(tabId)) return;

  await chrome.debugger.attach({ tabId }, "1.3");
  attachedTabs.add(tabId);
  await chrome.debugger.sendCommand({ tabId }, "Page.enable").catch(() => {});
  await chrome.debugger.sendCommand({ tabId }, "DOM.enable").catch(() => {});
  await chrome.debugger.sendCommand({ tabId }, "Runtime.enable").catch(() => {});
}

chrome.debugger.onDetach.addListener((source) => {
  if (source.tabId) {
    attachedTabs.delete(source.tabId);
  }
});

async function ensureContentScriptInjected(tabId) {
  try {
    await chrome.scripting.insertCSS({
      target: { tabId },
      files: ["content.css"]
    }).catch(() => {});
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"]
    }).catch(() => {});
  } catch (_) {}
}

// Forward agent branding to content script on first injection
async function injectAgentBranding(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, {
      action: "AGENT_CHANGED",
      agent: activeAgent
    });
  } catch (_) {}
}

async function executeCdpClick(tabId, x, y, label, isGuardrail = false) {
  await ensureDebuggerAttached(tabId);

  const animLabel = label || `Click at (${x}, ${y})`;
  const badgeState = isGuardrail ? "guardrail" : "normal";

  try {
    await chrome.tabs.sendMessage(tabId, {
      action: "SHOW_ACTION",
      x: Number(x),
      y: Number(y),
      label: animLabel,
      isClick: true,
      state: badgeState,
      agentBranding: activeAgent.branding
    });
  } catch (_) {
    // Fallback: CDP Runtime.evaluate for cursor animation
    const exprCursor = `(function() {
      let c = document.getElementById("bridge-cdp-cursor");
      if (!c) {
        c = document.createElement("div");
        c.id = "bridge-cdp-cursor";
        document.documentElement.appendChild(c);
      }
      c.style.cssText = "position: fixed !important; top: 0px !important; left: 0px !important; z-index: 2147483647 !important; pointer-events: none !important; width: 40px; height: 40px; transition: transform 0.35s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.25s ease !important; transform: translate3d(${x}px, ${y}px, 0px) !important; display: block !important; opacity: 1 !important;";
      const rip = document.createElement("div");
      rip.style.cssText = "position: fixed !important; top: 0px !important; left: 0px !important; z-index: 2147483646 !important; pointer-events: none !important; width: 24px; height: 24px; border-radius: 50% !important; border: 2px solid ${activeAgent.branding.primaryColor} !important; background: ${activeAgent.branding.primaryColor}33 !important; box-shadow: 0 0 14px ${activeAgent.branding.primaryColor} !important; transform: translate3d(${x - 12}px, ${y - 12}px, 0px) scale(0.3) !important; transition: transform 0.55s cubic-bezier(0, 0.2, 0.8, 1), opacity 0.55s ease !important;";
      document.documentElement.appendChild(rip);
      requestAnimationFrame(() => {
        rip.style.transform = "translate3d(${x - 12}px, ${y - 12}px, 0px) scale(3.5)";
        rip.style.opacity = "0";
        setTimeout(() => rip.remove(), 600);
      });
      c.innerHTML = '<div style="position:relative; width:40px; height:40px;"><div style="position:absolute; left:32px; top:22px; background:rgba(15,23,42,0.94); color:#ffffff; border:2px solid ${activeAgent.branding.primaryColor}; padding:6px 14px; border-radius:20px; font-size:12.5px; font-weight:700; white-space:nowrap;">${animLabel}</div></div>';
      setTimeout(() => { if (c) c.style.opacity = "0"; }, 3000);
    })()`;
    await chrome.debugger.sendCommand({ tabId }, "Runtime.evaluate", { expression: exprCursor }).catch(() => {});
  }

  await new Promise(r => setTimeout(r, 320));

  // Native DevTools Mouse Events
  await chrome.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: Number(x),
    y: Number(y)
  });
  await chrome.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: Number(x),
    y: Number(y),
    button: "left",
    clickCount: 1
  });
  await new Promise(r => setTimeout(r, 60));
  await chrome.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: Number(x),
    y: Number(y),
    button: "left",
    clickCount: 1
  });

  if (isRecording) {
    recordedSteps.push({
      action: "click",
      x: Number(x),
      y: Number(y),
      label: animLabel,
      agent: activeAgentId,
      timestamp: Date.now()
    });
  }

  return { clicked: true, x, y, label: animLabel, agent: activeAgentId };
}

// --- Command Router (agent-agnostic) ---

async function handleCommand(command, params, agentId) {
  let tabId = params.tabId;
  if (!tabId) {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    tabId = activeTab ? activeTab.id : null;
  }

  switch (command) {
    case "list_tabs": {
      const tabs = await chrome.tabs.query({});
      return tabs.map(t => ({
        id: t.id,
        windowId: t.windowId,
        title: t.title,
        url: t.url,
        active: t.active
      }));
    }

    case "focus_tab": {
      let targetTabId = params.tabId;
      if (!targetTabId && params.urlContains) {
        const tabs = await chrome.tabs.query({});
        const match = tabs.find(t => t.url && t.url.toLowerCase().includes(params.urlContains.toLowerCase()));
        if (match) targetTabId = match.id;
      }
      if (!targetTabId && params.titleContains) {
        const tabs = await chrome.tabs.query({});
        const match = tabs.find(t => t.title && t.title.toLowerCase().includes(params.titleContains.toLowerCase()));
        if (match) targetTabId = match.id;
      }

      if (!targetTabId) throw new Error("Target tab not found");

      const tab = await chrome.tabs.get(targetTabId);
      await chrome.windows.update(tab.windowId, { focused: true });
      await chrome.tabs.update(targetTabId, { active: true });
      return { focused: true, tabId: targetTabId, title: tab.title, url: tab.url };
    }

    case "navigate": {
      if (!params.url) throw new Error("URL is required");
      let targetTabId = tabId;
      if (!targetTabId) {
        const newTab = await chrome.tabs.create({ url: params.url });
        targetTabId = newTab.id;
      } else {
        await chrome.tabs.update(targetTabId, { url: params.url });
      }

      if (isRecording) {
        recordedSteps.push({ action: "navigate", url: params.url, agent: agentId, timestamp: Date.now() });
      }

      return { navigated: true, tabId: targetTabId, url: params.url };
    }

    case "tag_elements": {
      if (!tabId) throw new Error("No active tab to tag");
      await ensureContentScriptInjected(tabId);
      await injectAgentBranding(tabId);
      return await chrome.tabs.sendMessage(tabId, { action: "TAG_ELEMENTS" });
    }

    case "clear_tags": {
      if (!tabId) return { cleared: true };
      await ensureContentScriptInjected(tabId);
      return await chrome.tabs.sendMessage(tabId, { action: "CLEAR_TAGS" });
    }

    case "click_badge": {
      if (!tabId) throw new Error("No active tab for click");
      if (!params.badgeId) throw new Error("badgeId is required");
      await ensureContentScriptInjected(tabId);

      const badgeRes = await chrome.tabs.sendMessage(tabId, {
        action: "GET_BADGE",
        badgeId: params.badgeId
      });

      if (!badgeRes || !badgeRes.found) {
        throw new Error(`Badge [${params.badgeId}] was not found in active viewport`);
      }

      const label = params.actionLabel || `Click Badge [${params.badgeId}] ("${badgeRes.text || ""}")`;
      return await executeCdpClick(tabId, badgeRes.x, badgeRes.y, label);
    }

    case "detect_challenge": {
      if (!tabId) return { challenged: false };
      await ensureContentScriptInjected(tabId);
      return await chrome.tabs.sendMessage(tabId, { action: "DETECT_CHALLENGE" });
    }

    case "toggle_omnibar": {
      if (!tabId) throw new Error("No active tab for omnibar");
      await ensureContentScriptInjected(tabId);
      await injectAgentBranding(tabId);
      return await chrome.tabs.sendMessage(tabId, { action: "TOGGLE_OMNIBAR" });
    }

    case "start_recording": {
      isRecording = true;
      recordedSteps = [];
      return { recording: true, startedAt: Date.now(), agent: agentId };
    }

    case "stop_recording": {
      isRecording = false;
      const steps = [...recordedSteps];
      return { recording: false, stepCount: steps.length, steps };
    }

    case "get_recorded_recipe": {
      return { isRecording, steps: recordedSteps };
    }

    case "click": {
      if (!tabId) throw new Error("No active tab available for click");
      await ensureDebuggerAttached(tabId);

      let x = params.x;
      let y = params.y;
      const label = params.actionLabel || params.label || "";

      // Guardrail check
      const highStakesPattern = /delete|remove|drop|cancel campaign|pay|transfer|checkout|confirm order/i;
      const isHighStakes = (params.text && highStakesPattern.test(params.text)) ||
                           (label && highStakesPattern.test(label));

      if (isHighStakes && !params.force) {
        if (x !== undefined && y !== undefined) {
          await executeCdpClick(tabId, x, y, `GUARDRAIL: Held for Approval (${label || params.text})`, true);
        }
      }

      // Find element by selector/text/aria if coordinates not provided
      if ((x === undefined || y === undefined) && (params.selector || params.text || params.aria)) {
        try {
          await ensureContentScriptInjected(tabId);
          const findRes = await chrome.tabs.sendMessage(tabId, {
            action: "FIND_ELEMENT",
            query: { selector: params.selector, text: params.text, aria: params.aria }
          });
          if (findRes && findRes.found) {
            x = findRes.x;
            y = findRes.y;
          }
        } catch (_) {}

        if (x === undefined || y === undefined) {
          const targetText = params.text || "";
          const targetSelector = params.selector || "";
          const targetAria = params.aria || "";
          const expr = `(function() {
            let el = null;
            if (${JSON.stringify(targetSelector)}) {
              try { el = document.querySelector(${JSON.stringify(targetSelector)}); } catch(e) {}
            }
            if (!el && ${JSON.stringify(targetText)}) {
              const t = ${JSON.stringify(targetText)}.trim().toLowerCase();
              const candidates = Array.from(document.querySelectorAll("button, a, [role='button'], [role='tab'], span, label, th, td"));
              el = candidates.find(item => {
                const s = (item.innerText || item.textContent || "").trim().toLowerCase();
                return s === t || s.includes(t);
              });
            }
            if (!el && (${JSON.stringify(targetAria)} || ${JSON.stringify(targetText)})) {
              const term = (${JSON.stringify(targetAria)} || ${JSON.stringify(targetText)}).toLowerCase();
              el = Array.from(document.querySelectorAll("[aria-label], [title]")).find(item => {
                const a = (item.getAttribute("aria-label") || "").toLowerCase();
                const ti = (item.getAttribute("title") || "").toLowerCase();
                return a.includes(term) || ti.includes(term);
              });
            }
            if (!el) return null;
            el.scrollIntoView({ block: "center", inline: "center" });
            const r = el.getBoundingClientRect();
            return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
          })()`;

          const evalRes = await chrome.debugger.sendCommand({ tabId }, "Runtime.evaluate", {
            expression: expr,
            returnByValue: true
          });

          if (evalRes && evalRes.result && evalRes.result.value) {
            x = evalRes.result.value.x;
            y = evalRes.result.value.y;
          }
        }
      }

      if (x === undefined || y === undefined) {
        throw new Error(`Could not determine coordinates for target element (${params.text || params.selector || params.aria})`);
      }

      return await executeCdpClick(tabId, x, y, label);
    }

    case "type": {
      if (!tabId) throw new Error("No active tab available for typing");
      await ensureDebuggerAttached(tabId);
      const text = params.text || "";

      for (const char of text) {
        await chrome.debugger.sendCommand({ tabId }, "Input.dispatchKeyEvent", {
          type: "keyDown",
          text: char,
          unmodifiedText: char
        });
        await chrome.debugger.sendCommand({ tabId }, "Input.dispatchKeyEvent", {
          type: "keyUp"
        });
        await new Promise(r => setTimeout(r, 20));
      }

      if (isRecording) {
        recordedSteps.push({ action: "type", text, agent: agentId, timestamp: Date.now() });
      }

      return { typed: true, textLength: text.length };
    }

    case "screenshot": {
      if (!tabId) throw new Error("No active tab for screenshot");
      await ensureDebuggerAttached(tabId);

      const res = await chrome.debugger.sendCommand({ tabId }, "Page.captureScreenshot", {
        format: params.format || "png",
        quality: params.quality || undefined
      });

      return { screenshot: res.data };
    }

    case "get_dom": {
      if (!tabId) throw new Error("No active tab to read DOM");
      try {
        const dom = await chrome.tabs.sendMessage(tabId, { action: "EXTRACT_DOM" });
        return dom;
      } catch (_) {
        await ensureDebuggerAttached(tabId);
        const evalRes = await chrome.debugger.sendCommand({ tabId }, "Runtime.evaluate", {
          expression: "document.title + ' | ' + window.location.href",
          returnByValue: true
        });
        return { title: evalRes.result?.value };
      }
    }

    case "eval": {
      if (!tabId) throw new Error("No active tab for evaluation");
      await ensureDebuggerAttached(tabId);
      const evalRes = await chrome.debugger.sendCommand({ tabId }, "Runtime.evaluate", {
        expression: params.code || params.expression,
        returnByValue: true
      });
      if (evalRes.exceptionDetails) {
        throw new Error(evalRes.exceptionDetails.text || evalRes.exceptionDetails.exception?.description || "Evaluation exception");
      }
      return evalRes.result?.value;
    }

    case "get_agent_info": {
      return {
        activeAgent: activeAgent,
        allAgents: Object.keys(AGENTS).map(id => ({
          id,
          name: AGENTS[id].name,
          connected: Boolean(wsConnections[id] && wsConnections[id].readyState === WebSocket.OPEN)
        }))
      };
    }

    case "switch_agent": {
      if (!params.agentId || !AGENTS[params.agentId]) {
        throw new Error(`Unknown agent: ${params.agentId}`);
      }
      setActiveAgent(params.agentId);
      return { switched: true, activeAgent: activeAgent };
    }

    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

// --- Message listener from popup/content scripts ---

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "GET_ACTIVE_AGENT") {
    sendResponse({ agent: activeAgent, allAgents: Object.keys(AGENTS) });
    return true;
  }

  if (request.action === "SWITCH_AGENT") {
    if (AGENTS[request.agentId]) {
      setActiveAgent(request.agentId);
      sendResponse({ success: true, agent: activeAgent });
    } else {
      sendResponse({ success: false, error: "Unknown agent" });
    }
    return true;
  }

  if (request.action === "GET_AGENT_STATUS") {
    const statuses = {};
    for (const [id, agent] of Object.entries(AGENTS)) {
      const ws = wsConnections[id];
      statuses[id] = {
        name: agent.name,
        port: agent.port,
        connected: Boolean(ws && ws.readyState === WebSocket.OPEN),
        serverOnline: Boolean(serverOnline[id])
      };
    }
    sendResponse({ statuses, activeAgentId, activeAgent });
    return true;
  }
});

// Initial connection — only the active agent.
connectToBridge(activeAgentId);
