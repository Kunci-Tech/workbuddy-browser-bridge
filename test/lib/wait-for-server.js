// Wait for a TCP port to start accepting connections.
//
// The suites used to spawn a server and then guess how long it needed:
//
//     spawn("node", [serverPath], { env: { BRIDGE_PORT } });
//     setTimeout(() => { http.get(...); }, 500);   // <- a guess
//
// A fixed sleep is a bet that the child binds inside the window. Lose the bet -
// a cold module cache, a busy machine, or the previous suite's server still
// releasing its port - and the first request fails with ECONNREFUSED. That
// surfaces as "HTTP request failed: connect ECONNREFUSED", which reads exactly
// like a real regression, so a slow machine looks like broken code.
//
// The spawn "error" event does not cover this: it fires only when node itself
// cannot be started, not when the server is slow to listen.
//
// Polling removes the guess. We wait for evidence the port is open, and when it
// never opens the caller can say so and print the child's own output, instead of
// reporting a connection failure that has to be decoded after the fact.

const net = require("net");

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_INTERVAL_MS = 25;
const PROBE_TIMEOUT_MS = 500;

// One connection attempt. Resolves true if something is listening.
function probe(port, host = DEFAULT_HOST, timeoutMs = PROBE_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host });
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      socket.removeAllListeners();
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

// Poll until the port accepts a connection. Resolves true when it does, false
// once the deadline passes. Never rejects - the caller decides what a server
// that never listened means.
async function waitForPort(port, opts = {}) {
  const host = opts.host || DEFAULT_HOST;
  const timeoutMs = opts.timeoutMs === undefined ? DEFAULT_TIMEOUT_MS : opts.timeoutMs;
  const intervalMs = opts.intervalMs === undefined ? DEFAULT_INTERVAL_MS : opts.intervalMs;
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    if (await probe(port, host)) return true;
    if (Date.now() >= deadline) return false;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

module.exports = { waitForPort, probe };
