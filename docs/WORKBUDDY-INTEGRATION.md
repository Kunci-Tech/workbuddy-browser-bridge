# WorkBuddy AI Integration Guide

How to give WorkBuddy control of your Chrome browser. Two paths:

- **MCP (recommended)** — install once, WorkBuddy starts the bridge itself. No terminal.
- **REST** — for scripts, other agents, or manual testing.

---

## Path A: MCP (no terminal)

### How it works

```
WorkBuddy
   |  spawns automatically from ~/.workbuddy-ai/mcp.json (stdio JSON-RPC)
   v
MCP server  (mcp/server.js)
   |  hosts a WebSocket on 127.0.0.1:8766
   v
Chrome extension  (dials out, reconnects on its own)
   |  chrome.debugger / CDP
   v
Your Chrome tabs
```

WorkBuddy manages the server's lifecycle. When WorkBuddy is running, the bridge is up.

### Setup

```bash
cd workbuddy-browser-bridge
npm run install-mcp
```

That writes this entry into `~/.workbuddy-ai/mcp.json`, keeping any existing servers:

```json
{
  "mcpServers": {
    "browser-bridge": {
      "command": "/opt/homebrew/bin/node",
      "args": ["/absolute/path/to/workbuddy-browser-bridge/mcp/server.js"],
      "runtime": { "type": "node", "version": ">=18" }
    }
  }
}
```

Then **Trust** the server: WorkBuddy → connector management → custom connectors (top-right) → Trust on `browser-bridge`.

Finally load the extension: `chrome://extensions` → Developer mode → Load unpacked → select the project folder.

### Verify

```bash
npm run doctor
```

Checks the whole chain and prints a verdict — `PASS` / `WARN` / `FAIL`, with the fix command for anything broken. Before the manual steps above, two `WARN` items are expected. After them, you should see seven `PASS` and zero warnings.

To have an agent do the entire setup for you, use the copy-paste prompt in [AGENT-SETUP-PROMPT.md](AGENT-SETUP-PROMPT.md).

### Use it

Just ask in plain language:

- "Open google.com and search for the best coffee nearby"
- "Tag the buttons on this page and click the one labelled Save"
- "Screenshot my Google Ads campaigns table"
- "Fill the contact form with my details"

### Available tools

| Tool | Arguments | Notes |
| :--- | :--- | :--- |
| `browser_status` | — | Call first if anything looks wrong |
| `browser_list_tabs` | — | Returns id, title, url, active |
| `browser_focus_tab` | `urlContains` \| `titleContains` \| `tabId` | Brings a tab to the front |
| `browser_navigate` | `url`, `tabId?` | Opens a URL |
| `browser_tag_elements` | — | Numbered Set-of-Mark badges |
| `browser_click` | `badgeId` \| `text` \| `selector` \| `x`+`y`, `actionLabel?`, `force?` | Prefer `badgeId` |
| `browser_type` | `text` | Click the field first |
| `browser_screenshot` | `format?` | Returns a PNG image |
| `browser_get_dom` | — | Title, url, headings, elements |
| `browser_clear_tags` | — | Tidies up the badges |
| `browser_detect_challenge` | — | CAPTCHA / Cloudflare / 2FA check |

### Why prefer `browser_tag_elements` + `browser_click { badgeId }`

Screenshot-based clicking guesses pixel coordinates and misses on dense tables.
Tagging assigns stable numbers to real DOM elements, so the click lands on the
element itself — no coordinate drift, and far fewer image tokens.

---

## Path B: REST API

For scripts, Python, or another agent. Start the standalone server:

```bash
npm start                    # 8765 (Antigravity) + 8766 (WorkBuddy)
BRIDGE_PORT=9000 npm start   # single custom port
```

### Endpoints

| Endpoint | Method | Payload | Description |
| :--- | :--- | :--- | :--- |
| `/status` | GET | — | Health and extension connection |
| `/agents` | GET | — | All registered agents and their status |
| `/system-prompt` | GET | — | Active agent's prompt, guide, capabilities |
| `/command` | POST | `{"command": "...", "params": {}}` | Generic passthrough |
| `/tabs` | GET | — | List tabs |
| `/tab/focus` | POST | `{"urlContains": "ads"}` | Focus a tab |
| `/navigate` | POST | `{"url": "https://..."}` | Navigate |
| `/tags/create` | POST | — | Set-of-Mark tags |
| `/tags/clear` | POST | — | Clear tags |
| `/click/badge` | POST | `{"badgeId": 2}` | Click a badge |
| `/click` | POST | `{"x": 200, "y": 400}` | Click coordinates |
| `/type` | POST | `{"text": "Hello"}` | Native keystrokes |
| `/dom` | POST | — | Structured page data |
| `/screenshot` | POST | — | Base64 PNG |
| `/handshake/detect` | POST | — | Anti-bot check |
| `/omnibar/toggle` | POST | — | Toggle the in-page omnibar |
| `/record/start` \| `/record/stop` | POST | — | Macro recorder |
| `/record/recipe` | GET | — | Recorded recipe |

Route to a specific agent with the `X-Agent-Id` header or `?agent=`:

```bash
curl -H "X-Agent-Id: antigravity" http://127.0.0.1:8766/tabs
```

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

### Node client

```javascript
const browser = require("./bridge/client.js");

await browser.focusTab({ urlContains: "ads.google.com" });
const tags = await browser.tagElements();
await browser.clickBadge(1, "Opening the first result");
await browser.clearTags();
```

---

## Coexistence

The MCP server binds 8766; the standalone server binds 8765 and 8766. If a port is
already taken, the MCP server detects it and drives the extension through the
already-running bridge via `/command` instead of failing. Both can run at once.
