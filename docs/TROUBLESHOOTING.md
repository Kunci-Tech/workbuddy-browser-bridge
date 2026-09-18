# Troubleshooting

## Start here

```bash
npm run doctor
```

One command that checks the whole chain — Node version, project files, MCP registration, a live MCP handshake, and whether Chrome has connected — then prints a verdict:

- **PASS** — verified working
- **WARN** — fine, but a manual step hasn't happened yet (trusting the server, loading the extension)
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

1. Confirm the config entry exists:
   ```bash
   cat ~/.workbuddy-ai/mcp.json
   ```
   You should see a `browser-bridge` entry under `mcpServers`.
2. Re-run the installer if it's missing:
   ```bash
   npm run install-mcp
   ```
3. **Trust the server.** New MCP servers stay disabled until you explicitly trust them:
   WorkBuddy → connector management → custom connectors (top-right) → **Trust** on
   `browser-bridge`.

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

The MCP server is up but no extension has dialled in. Load the extension
(`chrome://extensions` → Load unpacked), then check the popup shows **Connected**.
Call `browser_status` to confirm.

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

A grey **OFF** badge is normal when the server is stopped. It is not an error state.

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

Changes to `mcp/server.js` or `bridge/*.js` need the bridge restarted instead. In MCP
mode WorkBuddy owns that process, so the simplest path is to restart WorkBuddy (or
run `node mcp/server.js` by hand while developing). Extension reloads are independent
of bridge restarts.

---

## Chrome shows "Browser Bridge started debugging this browser"

This is Chrome's standard banner whenever an extension uses the `chrome.debugger` API.
It confirms real DevTools Protocol events (`isTrusted: true`) are being dispatched
locally. All commands run on `127.0.0.1`; nothing leaves your machine. Dismiss the
banner when your task is done.
