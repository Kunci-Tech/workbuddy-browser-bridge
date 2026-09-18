# Agent Setup Prompt

A copy-paste prompt that lets an AI agent install and verify Browser Bridge for you.

This is the same prompt embedded in the [README](../README.md#install-with-ai), kept here as a standalone file so it's easy to link, diff, and update.

---

## The prompt

Copy everything in the block below and paste it into WorkBuddy — or any agent with shell access.

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

---

## Why it's written this way

### It separates what the agent can do from what only the human can do

Two steps in this install are physically impossible for an agent:

- **Trusting the MCP server** happens in WorkBuddy's own UI. No file write can pre-authorize it.
- **Loading the extension** happens in `chrome://extensions`, a page extensions cannot script.

An agent that doesn't know this will burn turns trying to automate them, or worse, will assume the whole install failed. The prompt names both steps explicitly and tells the agent to **stop and wait** at step 5.

### `npm run doctor` gives the agent a verdict, not a log dump

This is the most important line in the prompt.

Without it, an agent running `curl http://127.0.0.1:8766/status` sees `connection refused` and has no way to distinguish:

| What the agent sees | What it actually means |
| :--- | :--- |
| `connection refused` | Nothing is wrong — WorkBuddy hasn't been asked to spawn the bridge yet |
| `connection refused` | The MCP registration is genuinely broken |

Both produce identical output. An agent that guesses wrong starts reinstalling things that were already working, and the session spirals.

`doctor` collapses that ambiguity into three levels:

- **PASS** — verified working
- **WARN** — fine, but a manual step hasn't happened yet
- **FAIL** — genuinely broken, exits with code 1, and prints the exact fix command

The prompt tells the agent that `WARN` is expected at step 4. So it stops at the right moment instead of thrashing.

### It tells the agent not to start a server

The instinct for a capable agent is to "just run the server myself." That's the wrong move here, and it breaks the design: WorkBuddy is supposed to own the process lifecycle, so a manually-started server becomes a stale process holding port 8766.

The prompt forbids it and explains why.

### It warns about the tool-visibility lag

MCP tools only appear after the server is trusted **and** the session reloads. An agent that can't see `browser_navigate` yet might reasonably conclude the install failed. The prompt tells it to report the situation rather than guess.

### It protects stdout

The MCP transport is newline-delimited JSON-RPC on stdout. A single stray `console.log` from any module in the chain corrupts the stream and the server appears to hang. The prompt flags this so the agent doesn't add debugging output in the wrong place.

---

## Verify manually

If you'd rather not use an agent, the same checks run as a single command:

```bash
npm run doctor
```

And the full manual walkthrough is in the [Quickstart](../README.md#quickstart--install-once-no-terminal).

---

## Using a different agent

The prompt above is written for WorkBuddy, which manages the MCP server for you. Other agents don't speak MCP, so they use the REST bridge instead:

```bash
npm start                    # binds 8765 (Antigravity) + 8766 (WorkBuddy)
BRIDGE_PORT=9000 npm start   # or a single custom port
```

See [Other Agents](../README.md#other-agents-antigravity-rest-python) for the REST endpoints, Python example, and Node client. If you run the standalone server, the MCP server detects the port conflict and proxies through it automatically — the two coexist without extra configuration.
