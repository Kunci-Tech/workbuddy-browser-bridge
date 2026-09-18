# Browser Bridge for AI Agents

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Chrome Manifest V3](https://img.shields.io/badge/Chrome-Manifest%20V3-emerald.svg)](manifest.json)
[![Node.js](https://img.shields.io/badge/Node.js-Zero--Dependencies-success.svg)](package.json)
[![Multi-Agent](https://img.shields.io/badge/Multi--Agent-WorkBuddy%20%7C%20Antigravity%20%7C%20Extensible-purple.svg)](agents/registry.js)
[![Protocol](https://img.shields.io/badge/Protocol-Chrome%20DevTools%20(CDP)-orange.svg)](https://chromedevtools.github.io/devtools-protocol/)
[![Tests](https://img.shields.io/badge/Tests-7%20Suites%20Passing-brightgreen.svg)](test/)

> **Universal visual AI browser controller for WorkBuddy AI, Antigravity IDE, and any extensible AI agent.** Control your Chrome browser with native Chrome DevTools Protocol (CDP), Set-of-Mark (SoM) tagging, animated laser cursor, safety guardrails, and a per-agent system prompt and guide system.

---

## Quick install

Three commands, then two manual steps.

```bash
git clone https://github.com/Kunci-Tech/workbuddy-browser-bridge.git
cd workbuddy-browser-bridge
npm run install-mcp && npm run doctor
```

`install-mcp` registers the bridge with WorkBuddy — safe to re-run, and other MCP servers in your config are left untouched. `doctor` verifies the whole chain and tells you exactly what's missing.

Then the two things only you can do:

1. **Trust the server** — WorkBuddy → connector management → custom connectors (top-right) → **Trust** on `browser-bridge`.
2. **Load the extension** — `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select the `workbuddy-browser-bridge` folder.

Re-run `npm run doctor` and the extension should report as connected. The badge turns green **WOR**.

Prefer to have your agent do the whole thing? → **[Install with AI](#install-with-ai)**. Full step-by-step walkthrough → **[Quickstart](#quickstart--install-once-no-terminal)**.

---

## Install with AI

Paste this into WorkBuddy (or any agent with shell access). It runs the setup, verifies it, and hands back only the two steps that need a human:

```text
Set up Browser Bridge so you can control my Chrome browser directly.

Repo: https://github.com/Kunci-Tech/workbuddy-browser-bridge
If it is already cloned somewhere on this machine, use that copy instead of cloning again.

1. Check Node.js 18 or newer with `node --version`. If it is older, stop and tell me.
2. Get the project: git clone https://github.com/Kunci-Tech/workbuddy-browser-bridge.git && cd workbuddy-browser-bridge
3. Register the MCP server: npm run install-mcp
   This merges a "browser-bridge" entry into ~/.workbuddy-ai/mcp.json and leaves any
   other MCP servers untouched. Safe to re-run.
4. Verify: npm run doctor
   Report the full output. Fix anything marked FAIL before continuing.
   The "Live bridge" and "Chrome extension" warnings are expected right now — they are
   the two manual steps below.
5. Tell me the two things only I can do, and wait for my confirmation:
   a) Trust the server — WorkBuddy, connector management, custom connectors (top-right),
      click Trust on "browser-bridge".
   b) Load the extension — chrome://extensions, enable Developer mode, Load unpacked,
      select the workbuddy-browser-bridge folder.
6. After I confirm both, run npm run doctor again. The extension should show as connected.

Notes:
- Do not start a long-running server yourself. Once the MCP server is trusted, WorkBuddy
  spawns and manages the bridge automatically.
- The browser tools (browser_navigate, browser_click, browser_screenshot, ...) only become
  visible after the server is trusted AND the session reloads. If you cannot see them yet,
  say so instead of assuming the install failed.
- To debug the bridge, run `node mcp/server.js` in the background and read stderr. It must
  never write to stdout, because stdout carries the MCP protocol stream.
```

Also available as a standalone file: [`docs/AGENT-SETUP-PROMPT.md`](docs/AGENT-SETUP-PROMPT.md).

### Why the prompt works

`npm run doctor` is the key piece. It gives the agent a single command that returns a **verdict** rather than a wall of logs — so it can tell the difference between *"the install is broken"* and *"the human hasn't clicked Trust yet."*

Those two states look identical to an agent reading raw output, and conflating them is exactly what makes most AI-driven installs go in circles: the agent sees "not connected", assumes it failed, and starts reinstalling things that were already fine.

`doctor` checks the Node version, project files, the MCP registration (including whether the registered path still exists after a move), whether WorkBuddy has been restarted since the config was written, registry drift between `agents/registry.js` and `background.js`, a real MCP handshake against the server, and — by reading Chrome's own profile data — whether the extension is actually loaded, in which profile, and whether it is enabled. Every `FAIL` ships with the command that fixes it. Source: [`install/doctor.js`](install/doctor.js).

---

## Table of Contents

- [Quick install](#quick-install)
- [Install with AI](#install-with-ai)
- [Why Browser Bridge?](#why-browser-bridge)
- [How It Works — The Architecture](#how-it-works--the-architecture)
  - [The Big Picture](#the-big-picture)
  - [Layer 1: The Chrome Extension](#layer-1-the-chrome-extension)
  - [Layer 2: The Bridge Server](#layer-2-the-bridge-server)
  - [Layer 3: The MCP Server](#layer-3-the-mcp-server)
  - [Layer 4: The Agent Registry](#layer-4-the-agent-registry)
  - [How a Command Travels](#how-a-command-travels)
  - [The Zero-Dependency WebSocket Implementation](#the-zero-dependency-websocket-implementation)
  - [Coexistence: MCP and Standalone at Once](#coexistence-mcp-and-standalone-at-once)
- [5 Advanced Superpowers](#5-advanced-superpowers)
- [Quickstart — Install Once, No Terminal](#quickstart--install-once-no-terminal)
- [Browser Tools Exposed Over MCP](#browser-tools-exposed-over-mcp)
- [Other Agents (Antigravity, REST, Python)](#other-agents-antigravity-rest-python)
- [Adding a New Agent](#adding-a-new-agent)
- [Testing](#testing)
- [Project Structure](#project-structure)
- [License](#license)

---

## Why Browser Bridge?

Every AI agent that needs browser access faces the same tradeoff: pay $200/month for cloud VMs and hand over your credentials, or use fragile headless scripts that get blocked by anti-bot systems.

**Browser Bridge solves this.** It connects any local AI agent directly to your active, logged-in Chrome profile via a zero-dependency local bridge server and native Chrome DevTools Protocol. The extension is **agent-agnostic** — switch between WorkBuddy, Antigravity, or any future agent with a click.

### What makes this hackathon-worthy

| Feature | Browser Bridge | ChatGPT Browsing | OpenAI Operator | Puppeteer |
| :--- | :--- | :--- | :--- | :--- |
| **Multi-agent support** | WorkBuddy, Antigravity, extensible | ChatGPT only | OpenAI only | Code only |
| **Per-agent system prompts** | Built-in registry + guide system | No | No | No |
| **Execution host** | 100% localhost | Remote cloud | Cloud VM | Local |
| **Active session re-use** | Your logged-in Chrome | No sessions | Cloud VM login | Fresh login |
| **Visual grounding** | Set-of-Mark badges | None | Vision-only pixel guess | CSS/XPath |
| **Input events** | True native CDP (`isTrusted: true`) | Read-only | Remote synthetic | Synthetic JS |
| **Anti-bot handling** | Human handshake + auto-resume | Blocked | Often flagged | High detection |
| **In-page command bar** | Omnibar (Cmd+Shift+K) | No | No | No |
| **Macro recorder** | CDP-based, one-click | No | No | Code only |
| **Safety guardrails** | Hover & confirm red alert | No | No | No |
| **Dependencies** | Zero npm packages | — | — | Dozens |
| **Cost** | Free & unlimited (MIT) | $20/month | $200/month | Free tool |

---

## How It Works — The Architecture

### The Big Picture

```
                        You ask WorkBuddy:
                        "Screenshot my Google Ads campaigns"
                                    |
                                    v
                          +-------------------+
                          |   WorkBuddy AI    |
                          |   (the AI agent)  |
                          +-------------------+
                                  |
                          MCP (JSON-RPC over stdio)
                          WorkBuddy spawns this process
                                  |
                                  v
                    +-----------------------------+
                    |    mcp/server.js            |
                    |  (MCP stdio + WS hub)       |
                    |                             |
                    |  stdin  <-- MCP messages    |
                    |  stdout --> MCP responses   |
                    |  stderr --> logs (silent)   |
                    |                             |
                    |  ws://127.0.0.1:8766        |
                    |  (WebSocket server)         |
                    +-----------------------------+
                                  |
                          WebSocket (extension dials out)
                                  |
                                  v
                    +-----------------------------+
                    |  Chrome Extension (MV3)     |
                    |  background.js (service     |
                    |  worker)                     |
                    |                             |
                    |  chrome.debugger (CDP)      |
                    |  chrome.tabs                |
                    |  chrome.scripting           |
                    +-----------------------------+
                                  |
                          Chrome DevTools Protocol
                          (Input.dispatchMouseEvent,
                           Page.captureScreenshot, etc.)
                                  |
                                  v
                    +-----------------------------+
                    |   Your Chrome Tabs          |
                    |   (logged-in, real session) |
                    +-----------------------------+
```

The system has **four layers**, each cleanly separated. Here's what each one does and why it exists.

---

### Layer 1: The Chrome Extension

**Files:** `manifest.json`, `background.js`, `content.js`, `content.css`, `popup.html`, `popup.js`

The extension is the part that actually touches your browser. It's a **Manifest V3** extension — Chrome's latest extension platform — which means the background script is a *service worker*, not a persistent background page.

**`background.js` — The service worker (the brain)**

This is the command router. When a command arrives from the WebSocket, it dispatches it to the right Chrome API:

```
Incoming: { command: "click_badge", params: { badgeId: 3 } }
  -> chrome.tabs.sendMessage(tabId, { action: "GET_BADGE", badgeId: 3 })
     <- { found: true, x: 420, y: 310, text: "Save" }
  -> executeCdpClick(tabId, 420, 310, "Click Badge [3] (\"Save\")")
     -> chrome.debugger.sendCommand(Input.dispatchMouseEvent)
  -> { clicked: true, x: 420, y: 310, label: "..." }
```

Key design decisions:

- **Only connects to the active agent.** If it tried connecting to every registered agent, you'd get `ERR_CONNECTION_REFUSED` spam for agents you're not using. Instead, it holds one WebSocket to the active agent's port and closes it cleanly when you switch.
- **Exponential backoff.** When the bridge server isn't running, it retries at 2.5s, then 5s, then 15s — not a tight loop. The counter resets the moment a connection succeeds.
- **Grey "OFF" badge, not red "ERR".** A refused connection isn't an error — it just means the server isn't up yet. The badge is grey `OFF` until the bridge connects, then it shows the agent's short name in the agent's brand color.
- **`chrome.alarms` keepalive.** Service workers get killed after 30 seconds of inactivity. A 15-second alarm keeps the worker alive and triggers a reconnect if the socket dropped.
- **Guardrail pattern matching.** The `click` command checks the element text against `/delete|remove|drop|pay|transfer|checkout/i`. If it matches, the click fires with `state: "guardrail"` — the visual cursor shows a red pulsing alert instead of the normal green, prompting human confirmation.

**`content.js` — The visual overlay (the eyes and hands)**

Injected into every page at `document_start`. This is what creates the visual experience:

- **Laser cursor:** An SVG arrow that glides to click targets with a cubic-bezier easing curve, then fires a ripple animation on click.
- **Set-of-Mark (SoM) badges:** Numbered teal badges overlaid on every visible interactive element. Each badge is mapped to the element's center coordinates in a `Map`. When the agent says "click badge 3", we look up the coordinates — no pixel guessing.
- **Human handshake:** Scans the DOM for Cloudflare Turnstile iframes, reCAPTCHA widgets, and 2FA/OTP input fields. If found, plays an audio chime (Web Audio API) and shows an amber "Human Verification Required" badge.
- **Omnibar:** A glassmorphic command HUD (`Cmd+Shift+K`) that floats over any page. Type a natural-language prompt and it POSTs to the bridge's `/omnibar/prompt` endpoint.
- **Dynamic branding:** The `AGENT_CHANGED` message from the background script swaps the cursor gradient, badge colors, and omnibar styling to match the active agent's brand.

**`popup.html` / `popup.js` — The control panel**

The popup is the user-facing UI. It shows:
- An agent selector (click to switch between WorkBuddy and Antigravity)
- Connection status (green "Connected" or grey "Server offline")
- The active tab's title and URL
- An offline helper banner with a copy-to-clipboard start command
- Quick-start guide and examples (pulled from the agent's registry entry)
- Action buttons: test cursor, tag elements, open omnibar, record macro

The popup also does something clever: when it detects the bridge server is up (`/status` returns 200) but the extension's WebSocket isn't connected, it sends a `SWITCH_AGENT` message to the background — which nudges an immediate reconnect instead of waiting for the next backoff tick.

---

### Layer 2: The Bridge Server

**Files:** `bridge/server.js`, `bridge/ws-hub.js`, `bridge/routes.js`, `bridge/client.js`

This is the standalone server for agents that don't speak MCP (like Antigravity) or for manual/debug use.

**`bridge/ws-hub.js` — The shared transport core**

This is the heart of the system. It's a **zero-dependency RFC 6455 WebSocket implementation** — no `ws` npm package, no `socket.io`. Just `http` and `crypto` from Node's standard library.

It does three things:

1. **Hosts an HTTP server** with CORS headers (so the popup can `fetch('/status')` from any origin).
2. **Handles WebSocket upgrades** — the handshake, the frame parsing, the masking, the fragmentation.
3. **Routes commands to the extension and awaits responses** — a promise-based `executeOnExtension(command, params, agentId)` that sends a JSON message with a UUID, waits for the extension to reply with that same UUID, and resolves (or times out after 20s).

The `setRequestHandler(fn)` method is a deliberate design choice: it lets the MCP server attach its route handler *after* the hub is constructed. This avoids a temporal dead zone (TDZ) where the handler would need to reference the hub before it exists.

**`bridge/routes.js` — The REST surface**

Shared between the standalone server and the MCP server. This means the REST API is identical no matter which process hosts the hub:

```
GET  /status           -> { connected, port, agent, agents }
GET  /agents           -> list all registered agents
GET  /system-prompt    -> active agent's prompt, guide, capabilities
POST /command          -> generic passthrough (any command, any params)
GET  /tabs             -> list Chrome tabs
POST /tab/focus        -> focus a tab by URL/title/id
POST /navigate         -> open a URL
POST /tags/create      -> Set-of-Mark tagging
POST /tags/clear       -> remove badges
POST /click/badge      -> click a numbered badge
POST /click            -> click by text/selector/coordinates
POST /type             -> type text with native keystrokes
POST /dom              -> structured page summary
POST /screenshot       -> capture the visible tab
POST /eval             -> evaluate JavaScript in page context
POST /handshake/detect -> anti-bot challenge detection
POST /omnibar/toggle   -> toggle the in-page omnibar
POST /omnibar/prompt   -> send a natural-language prompt
POST /record/start     -> begin macro recording
POST /record/stop      -> stop and return recorded steps
GET  /record/recipe    -> get the current recorded recipe
```

Agent routing is done via the `X-Agent-Id` header or `?agent=` query param. This lets a single server on port 8766 drive the Antigravity agent on port 8765 — the `/command` endpoint proxies through to the right hub.

**`bridge/server.js` — The standalone launcher**

Binds one port per registered agent. With `BRIDGE_PORT` env var, it binds a single port for the default agent instead. Handles `EADDRINUSE` gracefully — if another process already holds the port, it logs that fact and moves on rather than crashing.

**`bridge/client.js` — The high-level API**

A fluent Node.js client for scripts and agents:

```javascript
const browser = require("./bridge/client.js");
browser.setAgent("workbuddy");
await browser.focusTab({ urlContains: "ads.google.com" });
const tags = await browser.tagElements();
await browser.clickBadge(1, "Clicking Save");
await browser.clearTags();
const shot = await browser.screenshot();
```

---

### Layer 3: The MCP Server

**File:** `mcp/server.js`

This is the **headline feature** — the thing that makes the extension "just work" with WorkBuddy. No terminal. No `npm start`. No background process to babysit.

**What is MCP?**

MCP (Model Context Protocol) is a JSON-RPC 2.0 protocol that runs over stdio. WorkBuddy spawns an MCP server as a child process, sends it method calls on stdin, and receives responses on stdout. The server can expose "tools" — functions the AI agent can call.

**How it works:**

```
WorkBuddy                        mcp/server.js
   |                                  |
   |--- initialize (stdin) --------->|
   |<--- serverInfo (stdout) ---------|
   |                                  |
   |--- tools/list (stdin) ---------->|
   |<--- 11 tools (stdout) -----------|
   |                                  |
   |--- tools/call browser_list_tabs>|
   |                                  |--- WS: { command: "list_tabs" } ---> extension
   |                                  |<--- WS: { result: [...] } ----------|
   |<--- tool result (stdout) --------|
   |                                  |
```

**Critical constraint: stdout is sacred.**

The MCP protocol requires that *only* JSON-RPC frames go to stdout. Any log message, error, or debug print that leaks to stdout corrupts the protocol stream. So every log in `mcp/server.js` goes to stderr:

```javascript
function log(...args) {
  process.stderr.write(`[browser-bridge] ${args.join(" ")}\n`);
}
```

**The 11 MCP tools:**

Each maps to a Chrome extension command:

| MCP Tool | Extension Command | Description |
| :--- | :--- | :--- |
| `browser_status` | (meta) | Check connection; call first if something fails |
| `browser_list_tabs` | `list_tabs` | List all open Chrome tabs |
| `browser_focus_tab` | `focus_tab` | Bring a tab to the front |
| `browser_navigate` | `navigate` | Open a URL |
| `browser_tag_elements` | `tag_elements` | Number every clickable element with SoM badges |
| `browser_click` | `click` or `click_badge` | Click by badge, text, selector, or coordinates |
| `browser_type` | `type` | Type with real native keystrokes |
| `browser_screenshot` | `screenshot` | Capture the visible tab as a PNG |
| `browser_get_dom` | `get_dom` | Structured page summary |
| `browser_clear_tags` | `clear_tags` | Remove the SoM badges |
| `browser_detect_challenge` | `detect_challenge` | Detect CAPTCHA / Cloudflare / 2FA |

Screenshots come back as `image` content blocks (base64 PNG), so the AI agent actually *sees* the page. Everything else is `text` content with JSON.

**Proxy mode:**

If the standalone server is already holding port 8766, the MCP server can't bind it. Instead of crashing, it enters **proxy mode** — it still speaks MCP to WorkBuddy, but routes extension commands through the already-running bridge's `/command` HTTP endpoint:

```javascript
async function callExtension(command, params = {}) {
  if (!proxyMode && hub.isConnected(AGENT_ID)) {
    return await hub.executeOnExtension(command, params, AGENT_ID);
  }
  // Proxy: delegate to the bridge already holding the port
  return await httpPost(`http://127.0.0.1:${PORT}/command`, {
    command, params, agentId: AGENT_ID
  });
}
```

This means you can run `npm start` for debugging, and when WorkBuddy spawns the MCP server, it just proxies through — no conflict, no crash.

---

### Layer 4: The Agent Registry

**File:** `agents/registry.js`

The registry is the single source of truth for agent configuration. Adding a new agent is literally adding one object:

```javascript
myagent: {
  id: "myagent",
  name: "My Custom Agent",
  shortName: "MyAgent",
  port: 8767,
  wsUrl: "ws://127.0.0.1:8767",
  httpUrl: "http://127.0.0.1:8767",
  branding: {
    primaryColor: "#yourcolor",
    accentGradient: "linear-gradient(...)",
    dark: "#...",
    light: "#..."
  },
  systemPrompt: "You are MyAgent Browser Bridge...",
  guide: {
    quickStart: "...",
    examples: ["...", "..."],
    tips: ["..."]
  },
  capabilities: ["navigate", "click", "type", "screenshot", ...]
}
```

The extension popup, content script branding, bridge server routing, and omnibar all adapt automatically. No core code changes needed.

**Note on `background.js` duplication:** The service worker inlines a minimal copy of the AGENTS map (just `id`, `name`, `shortName`, `port`, `wsUrl`, `httpUrl`, `branding`). This is intentional — Chrome MV3 service workers can't reliably use ES module imports for local files. The full registry (with system prompts, guides, capabilities) lives in `agents/registry.js` and is used by the Node.js side.

---

### How a Command Travels

Here's the full lifecycle of a single command — from you asking WorkBuddy to the click landing on the page:

```
1. You type: "Click the Save button on this page"

2. WorkBuddy decides to call:
   tools/call { name: "browser_tag_elements", arguments: {} }

3. WorkBuddy sends this as JSON-RPC over stdin to mcp/server.js:
   {"jsonrpc":"2.0","id":7,"method":"tools/call",
    "params":{"name":"browser_tag_elements","arguments":{}}}

4. mcp/server.js receives it, runs runTool("browser_tag_elements", {})
   -> calls callExtension("tag_elements", {})
   -> hub sends over WebSocket:
      {"id":"uuid-abc","command":"tag_elements","params":{}}

5. background.js receives the WS message:
   -> chrome.tabs.query({ active: true }) -> tabId
   -> chrome.scripting.executeScript({ files: ["content.js"] })
   -> chrome.tabs.sendMessage(tabId, { action: "TAG_ELEMENTS" })

6. content.js receives TAG_ELEMENTS:
   -> querySelectorAll("button, a, input, [role='button'], ...")
   -> filter to visible elements
   -> create numbered badge divs, position them
   -> build a Map: { 1: { el, x, y }, 2: { el, x, y }, ... }
   -> return { taggedCount: 12, elements: [...] }

7. background.js sends the result back over WS:
   {"id":"uuid-abc","success":true,"result":{"taggedCount":12,"elements":[...]}}

8. hub resolves the promise, mcp/server.js sends to stdout:
   {"jsonrpc":"2.0","id":7,"result":{
     "content":[{"type":"text","text":"{\"taggedCount\":12,...}"}]
   }}

9. WorkBuddy sees 12 elements, decides to click badge 5 ("Save"):
   tools/call { name: "browser_click", arguments: { badgeId: 5 } }

10. Same chain -> click_badge -> content.js looks up badge 5 in the Map
    -> returns { x: 420, y: 310 }
    -> executeCdpClick: chrome.debugger.sendCommand(Input.dispatchMouseEvent)
    -> a green laser cursor glides to (420, 310) and clicks
    -> the Save button fires with isTrusted: true
```

Total round-trip: ~50-100ms for a click, ~200ms for tagging (depends on page complexity).

---

### The Zero-Dependency WebSocket Implementation

`bridge/ws-hub.js` implements RFC 6455 from scratch. Here's why and how:

**Why not use the `ws` package?**

1. **Zero dependencies** is a hackathon selling point. `npm install` should be optional, not required.
2. The extension's WebSocket client is the browser's native `WebSocket` — the server side just needs to speak the same protocol.
3. The implementation is ~200 lines. It's auditable in one read.

**How it works:**

The WebSocket protocol (RFC 6455) frames look like this:

```
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-------+-+-------------+-------------------------------+
|F|R|R|R| opcode|M| Payload len |    Extended payload length    |
|I|S|S|S|  (4)  |A|     (7)     |             (16/64)           |
|N|V|V|V|       |S|             |   (if payload len==126/127)   |
| |1|2|3|       |K|             |                               |
+-+-+-+-+-------+-+-------------+ - - - - - - - - - - - - - - - - +
|     Extended payload length continued, if payload len == 127  |
+ - - - - - - - - - - - - - - - +-------------------------------+
|                               |Masking-key, if MASK set to 1  |
+-------------------------------+-------------------------------+
| Masking-key (continued)       |          Payload Data         |
+-------------------------------- - - - - - - - - - - - - - - - +
```

The implementation handles:
- **Fin bit** (message fragmentation across multiple frames)
- **Opcodes** (0x1 text, 0x0 continuation, 0x8 close, 0x9 ping, 0xA pong)
- **Payload length** (7-bit, 16-bit, 64-bit)
- **Client masking** (XOR with a 4-byte mask key — required for client-to-server frames)
- **Close handshake** (opcode 0x8)
- **Ping/pong** (keepalive — the extension sends PING every 10s, the hub responds with PONG)

---

### Coexistence: MCP and Standalone at Once

```
Scenario: You run `npm start` for debugging, then WorkBuddy spawns the MCP server.

1. npm start binds port 8766 (standalone server)
2. WorkBuddy spawns mcp/server.js
3. mcp/server.js tries to bind 8766 -> EADDRINUSE
4. proxyMode = true
5. When WorkBuddy calls browser_list_tabs:
   - mcp/server.js sends POST http://127.0.0.1:8766/command
     { command: "list_tabs", params: {}, agentId: "workbuddy" }
   - The standalone server's /command route handles it
   - Result comes back through the same WS hub
6. Everything works. No conflict.
```

---

## 5 Advanced Superpowers

1. **Set-of-Mark (SoM) Interactive Tagging** — glowing numbered badges over viewport elements for deterministic clicking. Instead of the AI guessing pixel coordinates from a screenshot, it gets a numbered list. "Click badge 3" always lands on the right element.

2. **Stealth Human Handshake** — auto-detects Cloudflare Turnstile, reCAPTCHA, and 2FA/OTP prompts. When detected: plays an audio chime (Web Audio API), shows an amber alert badge, and pauses automation. The user solves the challenge, and automation resumes on the next command.

3. **In-Page Floating AI Omnibar** (Cmd+Shift+K) — a glassmorphic command HUD that floats over any webpage. Type a natural-language prompt and it POSTs to the bridge. Chip buttons for quick tagging, clearing, inspecting, and capturing.

4. **One-Click CDP Macro Recorder** — record a sequence of clicks and navigations as a replayable recipe. Each step captures the action, coordinates, label, agent, and timestamp. Stop recording and get the full recipe back as JSON.

5. **Financial & Safety Guardrails** — the `click` command pattern-matches the target text against `/delete|remove|drop|cancel campaign|pay|transfer|checkout|confirm order/i`. If it matches and `force` isn't set, the visual cursor shows a pulsing red alert badge instead of clicking. The user must explicitly approve high-stakes actions.

---

## Quickstart — Install Once, No Terminal

The bridge is an **MCP server**, so WorkBuddy starts and stops it automatically. You never run a background process by hand.

### Step 1: Install the MCP server

```bash
cd workbuddy-browser-bridge
npm run install-mcp
```

This writes one entry into `~/.workbuddy-ai/mcp.json`, preserving any servers already there. Use `BRIDGE_NODE=/path/to/node` if you want to pin a specific Node binary.

### Step 2: Trust it in WorkBuddy

Open WorkBuddy → connector management → the custom connectors entry at the top-right → click **Trust** on `browser-bridge`.

From then on WorkBuddy spawns the bridge whenever it needs it.

### Step 3: Load the extension into Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the `workbuddy-browser-bridge` folder

The badge turns green **WOR** as soon as WorkBuddy's bridge is up.

### Step 4: Just ask

> "Open my Google Ads campaigns tab and screenshot the table."

WorkBuddy calls the browser tools directly — 11 of them, listed below.

### Step 5: Verify (anytime)

```bash
npm run doctor
```

One command that checks the entire chain and reports a verdict:

```
  PASS  Node.js            v22.22.2
  PASS  Project files      8 core files present
  PASS  MCP registration   browser-bridge -> /path/to/mcp/server.js
  PASS  Agent registry     2 agents, ports in sync with background.js
  PASS  MCP server         browser-bridge v2.0.0 — 11 tools, handshake OK
  WARN  Live bridge        nothing listening on port 8766
        -> Expected before first use — WorkBuddy spawns it once the MCP server is trusted.
  WARN  Chrome extension   not connected (no bridge to connect to)
        -> Load the extension: chrome://extensions -> Developer mode -> Load unpacked.

  5 passed · 2 warnings · 0 failures
```

A `WARN` is fine — it just means a manual step hasn't happened yet. A `FAIL` exits with code 1 and tells you the exact command to fix it. Run this first whenever something seems off.

---

## Browser Tools Exposed Over MCP

| Tool | Arguments | Description |
| :--- | :--- | :--- |
| `browser_status` | — | Check the extension connection; call this first if anything fails |
| `browser_list_tabs` | — | List every open Chrome tab with id, title, url, active |
| `browser_focus_tab` | `urlContains` \| `titleContains` \| `tabId` | Bring a tab to the front |
| `browser_navigate` | `url`, `tabId?` | Open a URL in the active or a new tab |
| `browser_tag_elements` | — | Number every clickable element with Set-of-Mark badges |
| `browser_click` | `badgeId` \| `text` \| `selector` \| `x`+`y`, `actionLabel?`, `force?` | Click an element (prefer `badgeId`) |
| `browser_type` | `text` | Type with real native keystrokes |
| `browser_screenshot` | `format?` (`png` \| `jpeg`) | Capture the visible tab as an image |
| `browser_get_dom` | — | Structured page summary: title, url, headings, elements |
| `browser_clear_tags` | — | Remove the SoM badges |
| `browser_detect_challenge` | — | Detect CAPTCHA / Cloudflare / 2FA needing a human |

---

## Other Agents (Antigravity, REST, Python)

Not every agent speaks MCP. For those, run the standalone server:

```bash
npm start                      # binds 8765 (Antigravity) and 8766 (WorkBuddy)
BRIDGE_PORT=9000 npm start     # or a single custom port
```

If the standalone server already holds a port, the MCP server detects it and drives the extension through the existing bridge instead of failing — so the two can coexist.

### Python example

```python
import requests

BRIDGE = "http://127.0.0.1:8766"

requests.post(f"{BRIDGE}/navigate", json={"url": "https://google.com"})

tags = requests.post(f"{BRIDGE}/tags/create").json()
print(f"Tagged {tags['taggedCount']} elements")

requests.post(f"{BRIDGE}/click/badge", json={
    "badgeId": 1,
    "actionLabel": "Clicking first element"
})
```

### Node.js client

```javascript
const browser = require("./bridge/client.js");

browser.setAgent("workbuddy");

await browser.focusTab({ urlContains: "ads.google.com" });
const tags = await browser.tagElements();
await browser.clickBadge(1, "Clicking Save");
await browser.clearTags();
const shot = await browser.screenshot();
```

### Per-agent system prompts

```bash
# Get WorkBuddy's system prompt and guide
curl http://127.0.0.1:8766/system-prompt

# Get Antigravity's system prompt
curl -H "X-Agent-Id: antigravity" http://127.0.0.1:8766/system-prompt
```

### Docs

- [WorkBuddy integration guide](docs/WORKBUDDY-INTEGRATION.md) — MCP setup, REST API reference, Python and Node examples, coexistence
- [Troubleshooting](docs/TROUBLESHOOTING.md) — connection errors, MCP issues, badge states, reconnect behavior, port conflicts

---

## Adding a New Agent

Add an entry to `agents/registry.js`:

```javascript
myagent: {
  id: "myagent",
  name: "My Custom Agent",
  shortName: "MyAgent",
  port: 8767,
  wsUrl: "ws://127.0.0.1:8767",
  httpUrl: "http://127.0.0.1:8767",
  branding: {
    primaryColor: "#yourcolor",
    accentGradient: "linear-gradient(135deg, #... 0%, #... 100%)",
    dark: "#...",
    light: "#..."
  },
  systemPrompt: "You are MyAgent Browser Bridge...",
  guide: {
    quickStart: "...",
    examples: ["...", "..."],
    tips: ["..."]
  },
  capabilities: ["navigate", "click", "type", "screenshot", ...]
}
```

Then add a matching entry to the `AGENTS` map in `background.js` (service workers can't import the registry). The extension popup, content script branding, bridge server routing, and omnibar all adapt automatically.

---

## Testing

```bash
npm test
```

Runs 6 test suites:

| Suite | What it verifies |
| :--- | :--- |
| `sanitize-check.test.js` | No hardcoded paths, API keys, or tokens in any file |
| `bridge-api.test.js` | The `/status` endpoint responds correctly |
| `features.test.js` | All 18 client library methods exist; omnibar prompt works |
| `multi-agent.test.js` | `/agents` returns both agents; `X-Agent-Id` header routes correctly |
| `mcp.test.js` | MCP initialize handshake, tools/list (11 tools), tools/call, unknown method → -32601 |
| `mcp-e2e.test.js` | Full chain: MCP → WebSocket → fake extension → response back. Event-driven, no fixed timers. |

---

## Project Structure

```
workbuddy-browser-bridge/
├── manifest.json              # Chrome MV3 extension manifest
├── background.js              # Service worker: CDP router, WS client, badge manager
├── content.js                 # Content script: laser cursor, SoM badges, omnibar, handshake
├── content.css                # Overlay styles (cursor, badges, omnibar, ripple)
├── popup.html                 # Extension popup: agent selector, status, guide, actions
├── popup.js                   # Popup logic: branding, status check, button handlers
├── package.json               # npm scripts and metadata
├── LICENSE                    # MIT
├── .gitignore
├── start-bridge.sh            # macOS/Linux launcher
├── start-bridge.bat           # Windows launcher
│
├── agents/
│   └── registry.js            # Central agent config (add an agent = add an object)
│
├── bridge/
│   ├── ws-hub.js              # Zero-dep RFC 6455 WebSocket server + command dispatch
│   ├── routes.js              # Shared REST route handler (used by both servers)
│   ├── server.js              # Standalone HTTP+WS server (binds all agent ports)
│   ├── client.js              # High-level Node.js client library
│   ├── demo.js                # Interactive demo script
│   └── test-connection.js     # Quick connection status checker
│
├── mcp/
│   └── server.js              # MCP stdio server + WS hub (spawned by WorkBuddy)
│
├── install/
│   ├── install-mcp.js         # Merges browser-bridge into ~/.workbuddy-ai/mcp.json
│   ├── chrome-profiles.js     # Reads Chrome profiles to find the loaded extension
│   └── doctor.js              # One-command install health check (npm run doctor)
│
├── test/
│   ├── sanitize-check.test.js # Credential & path leak audit
│   ├── bridge-api.test.js     # Bridge /status endpoint
│   ├── features.test.js       # 18 client methods + omnibar
│   ├── multi-agent.test.js    # Registry + X-Agent-Id routing
│   ├── mcp.test.js            # MCP protocol handshake + tools
│   ├── mcp-e2e.test.js        # Full MCP → WS → extension round trip
│   └── doctor-chrome.test.js  # Chrome profile scanning for the doctor
│
├── docs/
│   ├── WORKBUDDY-INTEGRATION.md  # MCP setup, REST API, Python/Node examples
│   ├── AGENT-SETUP-PROMPT.md     # Copy-paste prompt for AI-driven install
│   └── TROUBLESHOOTING.md        # Connection errors, MCP issues, badge states
│
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

---

## License

MIT License (c) 2026 Rahmat Ramadhan Irianto — [Kunci-Tech](https://github.com/Kunci-Tech)
