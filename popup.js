// Browser Bridge Popup Script
// Multi-agent selector, dynamic branding, agent-specific guides

// Agent definitions (mirrored from background.js for popup use)
const AGENTS = {
  workbuddy: {
    id: "workbuddy",
    name: "WorkBuddy AI",
    shortName: "WorkBuddy",
    port: 8766,
    httpUrl: "http://127.0.0.1:8766",
    branding: {
      primaryColor: "#1D9E75",
      accentGradient: "linear-gradient(135deg, #1D9E75 0%, #5DCAA5 50%, #A0E8C5 100%)",
      dark: "#04342C",
      light: "#E1F5EE"
    },
    guide: {
      quickStart: "Ask WorkBuddy to navigate, click, type, or screenshot any web page. Use 'tag elements' to see clickable targets as numbered badges.",
      examples: [
        "Go to google.com and search for 'best coffee'",
        "Take a screenshot of this page",
        "Tag all buttons and click badge 3",
        "Fill the contact form with my info"
      ]
    }
  },
  antigravity: {
    id: "antigravity",
    name: "Antigravity IDE",
    shortName: "Antigravity",
    port: 8765,
    httpUrl: "http://127.0.0.1:8765",
    branding: {
      primaryColor: "#38bdf8",
      accentGradient: "linear-gradient(135deg, #38bdf8 0%, #818cf8 50%, #c084fc 100%)",
      dark: "#0C447C",
      light: "#E6F1FB"
    },
    guide: {
      quickStart: "Use the bridge client library to control Chrome. Tag elements, click badges, type text, and capture screenshots.",
      examples: [
        "browser.focusTab({ urlContains: 'ads' })",
        "browser.tagElements() then browser.clickBadge(4)",
        "browser.click({ text: 'Save' })",
        "browser.screenshot()"
      ]
    }
  }
};

document.addEventListener("DOMContentLoaded", async () => {
  const logo = document.getElementById("logo");
  const extTitle = document.getElementById("ext-title");
  const extSubtitle = document.getElementById("ext-subtitle");
  const agentSelector = document.getElementById("agent-selector");
  const bridgeLabel = document.getElementById("bridge-label");
  const statusBadge = document.getElementById("bridge-status");
  const statusText = document.getElementById("bridge-status-text");
  const tabTitleEl = document.getElementById("active-tab-title");
  const tabUrlEl = document.getElementById("active-tab-url");
  const btnTestCursor = document.getElementById("btn-test-cursor");
  const btnTagSom = document.getElementById("btn-tag-som");
  const btnToggleOmnibar = document.getElementById("btn-toggle-omnibar");
  const btnRecordMacro = document.getElementById("btn-record-macro");
  const guideTitle = document.getElementById("guide-title");
  const guideQuickstart = document.getElementById("guide-quickstart");
  const guideExamples = document.getElementById("guide-examples");
  const offlineHelp = document.getElementById("offline-help");
  const cmdText = document.getElementById("cmd-text");
  const cmdCopy = document.getElementById("cmd-copy");

  let isRecording = false;
  let activeAgent = AGENTS.workbuddy;

  // Get active tab info
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    tabTitleEl.textContent = tab.title || "Untitled Tab";
    tabUrlEl.textContent = tab.url || "";
  }

  // Build agent selector tabs
  function buildAgentSelector() {
    agentSelector.innerHTML = "";
    for (const [id, agent] of Object.entries(AGENTS)) {
      const tabEl = document.createElement("div");
      tabEl.className = "agent-tab" + (id === activeAgent.id ? " active" : "");
      tabEl.dataset.agentId = id;

      const iconEl = document.createElement("div");
      iconEl.className = "agent-tab-icon";
      iconEl.style.background = agent.branding.accentGradient;

      const nameEl = document.createElement("div");
      nameEl.className = "agent-tab-name";
      nameEl.textContent = agent.shortName;

      const statusEl = document.createElement("div");
      statusEl.className = "agent-tab-status";
      statusEl.style.background = "#64748b";
      statusEl.dataset.agentId = id;

      tabEl.appendChild(iconEl);
      tabEl.appendChild(nameEl);
      tabEl.appendChild(statusEl);

      tabEl.addEventListener("click", () => switchAgent(id));
      agentSelector.appendChild(tabEl);
    }
  }

  // Apply agent branding to popup
  function applyAgentBranding(agent) {
    document.documentElement.style.setProperty("--agent-primary", agent.branding.primaryColor);
    document.documentElement.style.setProperty("--agent-grad", agent.branding.accentGradient);
    logo.style.background = agent.branding.accentGradient;
    logo.style.boxShadow = `0 0 14px ${agent.branding.primaryColor}66`;
    bridgeLabel.textContent = `Bridge (Port ${agent.port})`;
  }

  // Update guide content
  function updateGuide(agent) {
    guideTitle.textContent = `${agent.shortName} quick guide`;
    guideQuickstart.textContent = agent.guide.quickStart;
    guideExamples.innerHTML = "";
    for (const ex of agent.guide.examples) {
      const li = document.createElement("li");
      li.textContent = ex;
      guideExamples.appendChild(li);
    }
  }

  // Switch active agent
  function switchAgent(agentId) {
    const agent = AGENTS[agentId];
    if (!agent) return;
    activeAgent = agent;

    chrome.runtime.sendMessage({ action: "SWITCH_AGENT", agentId }, (response) => {
      if (response && response.success) {
        applyAgentBranding(agent);
        updateGuide(agent);
        checkBridge();
        // Update active tab styling
        document.querySelectorAll(".agent-tab").forEach(el => {
          el.classList.toggle("active", el.dataset.agentId === agentId);
        });
      }
    });
  }

  // Check bridge status for active agent
  async function checkBridge() {
    try {
      const res = await fetch(`${activeAgent.httpUrl}/status`);
      if (res.ok) {
        const data = await res.json();
        offlineHelp.classList.remove("visible");
        if (data.connected) {
          statusBadge.classList.remove("offline");
          statusText.textContent = "Connected";
        } else {
          statusBadge.classList.remove("offline");
          statusText.textContent = "Server up, no ext";
          // Server is reachable but our socket isn't up — nudge the background
          // to reconnect now instead of waiting for the next backoff tick.
          chrome.runtime.sendMessage({ action: "SWITCH_AGENT", agentId: activeAgent.id });
        }
      } else {
        throw new Error();
      }
    } catch (_) {
      // Server not running — show the actionable helper instead of a dead end.
      statusBadge.classList.add("offline");
      statusText.textContent = "Server offline";
      offlineHelp.classList.add("visible");
    }
  }

  // Check all agent connection statuses
  async function checkAllAgentStatuses() {
    for (const [id, agent] of Object.entries(AGENTS)) {
      const statusEl = document.querySelector(`.agent-tab-status[data-agent-id="${id}"]`);
      if (!statusEl) continue;
      try {
        const res = await fetch(`${agent.httpUrl}/status`);
        if (res.ok) {
          const data = await res.json();
          statusEl.style.background = data.connected ? "#10b981" : "#f59e0b";
        } else {
          statusEl.style.background = "#ef4444";
        }
      } catch (_) {
        statusEl.style.background = "#ef4444";
      }
    }
  }

  // Get saved active agent from background
  chrome.runtime.sendMessage({ action: "GET_ACTIVE_AGENT" }, (response) => {
    if (response && response.agent && response.agent.id && AGENTS[response.agent.id]) {
      activeAgent = AGENTS[response.agent.id];
    }
    applyAgentBranding(activeAgent);
    updateGuide(activeAgent);
    buildAgentSelector();
    checkBridge();
    checkAllAgentStatuses();
  });

  // Show the right start command for the user's OS
  chrome.runtime.getPlatformInfo?.((info) => {
    if (!info || !cmdText) return;
    if (info.os === "win") {
      cmdText.textContent = "start-bridge.bat";
    } else {
      cmdText.textContent = "cd workbuddy-browser-bridge && ./start-bridge.sh";
    }
  });

  // Copy-to-clipboard for the start command
  cmdCopy?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(cmdText.textContent);
      cmdCopy.textContent = "Copied";
      cmdCopy.classList.add("copied");
      setTimeout(() => {
        cmdCopy.textContent = "Copy";
        cmdCopy.classList.remove("copied");
      }, 1600);
    } catch (_) {
      // Clipboard can be blocked; the text is selectable as a fallback.
      cmdText.focus?.();
    }
  });

  // Button handlers
  btnTestCursor.addEventListener("click", async () => {
    if (!tab || !tab.id) return;
    try {
      await chrome.tabs.sendMessage(tab.id, {
        action: "SHOW_ACTION",
        x: Math.round(window.screen.availWidth / 2),
        y: 350,
        label: `${activeAgent.shortName} Laser Cursor Active!`,
        isClick: true
      });
      btnTestCursor.textContent = "Laser Triggered!";
      setTimeout(() => { btnTestCursor.textContent = "Test Visual Laser Cursor"; }, 2000);
    } catch (_) {
      alert("Please refresh the active web page to enable the content script overlay!");
    }
  });

  btnTagSom.addEventListener("click", async () => {
    if (!tab || !tab.id) return;
    try {
      const res = await chrome.tabs.sendMessage(tab.id, { action: "TAG_ELEMENTS" });
      if (res && res.taggedCount !== undefined) {
        btnTagSom.textContent = `Tagged ${res.taggedCount} Badges!`;
        setTimeout(() => { btnTagSom.textContent = "Tag Elements (Set-of-Mark)"; }, 2500);
      }
    } catch (_) {
      alert("Please refresh the web page to tag elements!");
    }
  });

  btnToggleOmnibar.addEventListener("click", async () => {
    if (!tab || !tab.id) return;
    try {
      await chrome.tabs.sendMessage(tab.id, { action: "TOGGLE_OMNIBAR" });
      window.close();
    } catch (_) {
      alert("Please refresh the web page to open the Omnibar!");
    }
  });

  btnRecordMacro.addEventListener("click", async () => {
    isRecording = !isRecording;
    if (isRecording) {
      btnRecordMacro.classList.add("recording");
      btnRecordMacro.textContent = "Stop Recording";
      try {
        await fetch(`${activeAgent.httpUrl}/record/start`, { method: "POST" });
      } catch (_) {}
    } else {
      btnRecordMacro.classList.remove("recording");
      btnRecordMacro.textContent = "Start Macro Recorder";
      try {
        const res = await fetch(`${activeAgent.httpUrl}/record/stop`, { method: "POST" });
        const data = await res.json();
        alert(`Macro recorded! Captured ${data.stepCount || 0} action(s).`);
      } catch (_) {}
    }
  });
});
