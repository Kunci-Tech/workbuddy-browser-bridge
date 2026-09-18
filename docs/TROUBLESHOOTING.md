# Troubleshooting

## Start here

```bash
npm run doctor
```

One command that checks the whole chain — Node version, project files, MCP registration, whether the server has actually been trusted, a live MCP handshake, and whether Chrome actually has the extension loaded and enabled — then prints a verdict:

- **PASS** — verified working
- **WARN** — fine, but a manual step hasn't happened yet (trusting the server, loading the extension, starting a new conversation)
- **FAIL** — genuinely broken. Exits with code 1 and prints the exact fix command.

Run this before reading any further. Most issues are answered by its output.

---

## "WebSocket connection to 'ws://127.0.0.1:8766/' failed: net::ERR_CONNECTION_REFUSED"

**This means nothing is listening on port 8766 yet. It is not a bug.**

The extension is a WebSocket *client*: it dials out and retries on its own. When no
bridge is up, Chrome logs a connection-refused message. With the MCP setup this
normally resolves itself the moment WorkBuddy starts.

### Check these in order

1. **Is WorkBuddy running?** The MCP server is spawned by WorkBuddy, so if WorkBuddy
   is closed, there is no bridge. That's expected — open WorkBuddy.
2. **Did you trust the MCP server?** WorkBuddy → connector management → custom
   connectors (top-right) → **Trust** on `browser-bridge`. Until it's trusted,
   WorkBuddy won't spawn it.
3. **Is the extension loaded?** `chrome://extensions` → Developer mode → Load unpacked
   → select the `workbuddy-browser-bridge` folder.
4. **Not using WorkBuddy?** Then start the bridge yourself:

```bash
cd workbuddy-browser-bridge
npm start          # or ./start-bridge.sh
```

Once a bridge is up the extension reconnects within seconds — no reload needed, and
the badge goes from grey **OFF** to green **WOR**.

### Verify

```bash
curl http://127.0.0.1:8766/status
```

Expect `"connected":true`:

```json
{"status":"ok","connected":true,"port":8766,"agent":"workbuddy","agents":{"workbuddy":true,"antigravity":false}}
```

Or just open the extension popup — the status pill reads **Connected**.


---

## MCP-specific issues

### The browser tools don't appear in WorkBuddy

Work through these in order — the first is the most common and the least obvious.

1. **Start a new conversation.** The `browser_*` tools are injected when a conversation
   starts. A conversation that was already open when you trusted the server will never
   see them, no matter how long you wait or how many times you re-run `doctor`. This is
   by far the most common cause, and it is easy to miss precisely because everything
   else looks correct.
2. **Check the trust landed:**
   ```bash
   npm run doctor
   ```
   Look for the `MCP trust` line. `PASS  MCP trust  browser-bridge approved` means
   WorkBuddy has approved it. A warning means it has not — an MCP server stays dormant
   until it is explicitly trusted, however correct the config is.
3. **Trust it if it is not approved** — WorkBuddy → connector management → custom
   connectors (top-right) → **Trust** on `browser-bridge`. Then go back to step 1.
4. **Confirm the config entry exists:**
   ```bash
   cat ~/.workbuddy-ai/mcp.json
   ```
   You should see a `browser-bridge` entry under `mcpServers`. If it is missing:
   ```bash
   npm run install-mcp
   ```
5. **Still nothing?** Drive Chrome over HTTP instead — it bypasses the MCP layer entirely
   and takes seconds. See [Driving Chrome without the MCP tools](#driving-chrome-without-the-mcp-tools).

### The MCP server exits immediately

Run it by hand and read stderr:

```bash
node mcp/server.js
```

It should print `MCP server ready on port 8766`. If it reports a port conflict, another
bridge already holds 8766 — that's handled automatically via proxy mode, but check for
a stale process:

```bash
lsof -ti :8766 | xargs kill -9
```

### Tools return "Chrome extension is not connected"

The MCP server is up but no extension has dialled in. There are four causes, and from the
outside they look identical — so check them in this order:

1. **The extension is not loaded.** `chrome://extensions` → **Developer mode** →
   **Load unpacked** → select the folder containing `manifest.json`. `npm run doctor`
   prints the exact path to use, and says `not loaded in any ... profile` if this is it.
2. **It is loaded in a different Chrome profile.** An unpacked extension is only active in
   the profile that has it loaded. Load it in `Default` but browse in `Profile 12` and the
   bridge never sees it. `doctor` names the profile it found (`loaded v2.0.0 in Profile 12
   (Chrome)`) — browse there, or load the extension into the profile you actually use.
3. **A look-alike extension is the one loaded.** Sibling projects in a shared workspace
   produce near-identical names — an older Antigravity-only build, for instance. Loading
   the wrong folder looks like a successful install that simply never connects. `doctor`
   lists these under `Other extensions`; the folder it prints is the correct one.
4. **It is loaded but disabled.** Toggle it back on at `chrome://extensions`, then reload
   the page you want to automate.

Once it is right the popup shows **Connected**, and `browser_status` returns
`connected: true`.

### Pinning a specific Node binary

The installer records whichever Node ran it. To choose explicitly:

```bash
BRIDGE_NODE=/opt/homebrew/bin/node npm run install-mcp
```

---

## Badge states

| Badge | Meaning |
| :--- | :--- |
| **WOR** (green) | Connected to the WorkBuddy bridge on port 8766 |
| **ANT** (blue) | Connected to the Antigravity bridge on port 8765 |
| **OFF** (grey) | Extension loaded, bridge server not running — start it |
| blank | Service worker is waking up / reconnecting |

### "My badge says OFF — is it broken?"

Almost certainly not. **OFF is the correct state before first use.**

The bridge is not a background daemon. WorkBuddy spawns it on demand, when a browser tool
is first called, and stops it afterwards. So in the window between loading the extension
and actually asking WorkBuddy to browse, there is nothing for the extension to connect to,
and it correctly reports **OFF**.

It turns green **WOR** the moment the bridge comes up. If you want to watch that happen,
run the bridge yourself in one terminal:

```bash
./start-bridge.sh
```

The badge should flip to **WOR** within a second or two. `Ctrl-C` stops it and the badge
returns to **OFF**. That is the whole lifecycle — nothing is wrong.

The one case worth acting on: if the badge stays **blank** indefinitely, the extension's
service worker is not waking up. Reload it from `chrome://extensions`.

---

## Driving Chrome without the MCP tools

The bridge exposes a plain HTTP API alongside MCP, so you are never actually blocked on
the MCP layer. This is the quickest way to prove the extension works, and a perfectly
good way to drive Chrome when the tools are not available.

Start the bridge:

```bash
./start-bridge.sh
```

Check that an extension has dialled in:

```bash
curl -s http://127.0.0.1:8766/status
```

```json
{"status":"ok","connected":true,"port":8766,"agent":"workbuddy",
 "agents":{"workbuddy":true,"antigravity":true}}
```

Then send commands to the same endpoint the MCP tools use internally:

```bash
# navigate
curl -s -X POST http://127.0.0.1:8766/command \
  -H "Content-Type: application/json" \
  -d '{"command":"navigate","params":{"url":"https://www.google.com"},"agentId":"workbuddy"}'
# {"result":{"navigated":true,"tabId":911564028,"url":"https://www.google.com"}}

# list tabs
curl -s -X POST http://127.0.0.1:8766/command \
  -H "Content-Type: application/json" \
  -d '{"command":"list_tabs","params":{},"agentId":"workbuddy"}'
```

`agentId` is `workbuddy` (port 8766) or `antigravity` (port 8765). The remaining commands
mirror the MCP tool names — `click`, `click_badge`, `type`, `screenshot`, `tag_elements`,
`clear_tags`, `get_dom`, `detect_challenge`. `screenshot` returns base64 in
`result.screenshot`.

One gotcha: `/status` can briefly report `workbuddy:false, antigravity:true` while the
extensions are still dialling in. Re-poll before concluding anything.

Stop the bridge with `Ctrl-C`, or:

```bash
lsof -ti :8766 | xargs kill
```

---

## Reconnect behaviour

The extension retries with a gentle backoff so a stopped server doesn't flood the
DevTools console:

- Attempts 1–4: every 2.5 s
- Attempts 5–10: every 5 s
- Attempts 11+: every 15 s

The counter resets the moment a connection succeeds. Opening the extension popup also
nudges an immediate reconnect if the server has come back.

---

## Only one agent connects at a time

The extension connects **only to the active agent** (WorkBuddy by default). This is
deliberate: connecting to every registered agent would spam the console with
`ERR_CONNECTION_REFUSED` for agents you aren't using. Switch agents in the popup and
the previous socket is closed cleanly.

---

## Port already in use

```
Error: listen EADDRINUSE: address already in use :::8766
```

Find and stop the old process:

```bash
# macOS / Linux
lsof -ti :8766 | xargs kill -9

# Windows
netstat -ano | findstr :8766
taskkill /F /PID <PID>
```

Or run on a different port:

```bash
BRIDGE_PORT=9000 npm start
```

---

## Content script overlay not appearing

The laser cursor, Set-of-Mark badges, and omnibar are injected by the content script.
Chrome only injects content scripts into pages opened **after** the extension loaded.

- Refresh the page once (`Cmd+R` / `Ctrl+R`) after loading the extension.
- Chrome blocks content scripts on internal pages (`chrome://`, `chrome-extension://`,
  and the Chrome Web Store). Test on a normal site like `https://google.com`.

---

## After editing extension files

If you change `background.js`, `content.js`, `popup.js`, `popup.html`, or `content.css`,
you must reload the extension:

1. Open `chrome://extensions`
2. Click the reload icon on the Browser Bridge card
3. Refresh any open tabs so the new content script is injected

Changes to `mcp/server.js` or `bridge/*.js` need the bridge process restarted instead. In
MCP mode WorkBuddy owns that process, so start a new conversation (or run
`node mcp/server.js` by hand while developing). Extension reloads are independent of
bridge restarts.

---

## Chrome shows "Browser Bridge started debugging this browser"

This is Chrome's standard banner whenever an extension uses the `chrome.debugger` API.
It confirms real DevTools Protocol events (`isTrusted: true`) are being dispatched
locally. All commands run on `127.0.0.1`; nothing leaves your machine. Dismiss the
banner when your task is done.
