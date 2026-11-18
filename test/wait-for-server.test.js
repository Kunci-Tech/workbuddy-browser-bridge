// Test Seam 8: readiness polling
//
// Every other suite that talks to a spawned server depends on this helper. A
// poller that quietly degraded into a fixed sleep would reintroduce the flake
// without failing anything else, so its behaviour is pinned here.
//
// Three properties matter:
//   1. it waits for a server that binds late (and does not report early)
//   2. it gives up on a port that never opens, near the deadline, not never
//   3. it returns promptly when the port is already open
//
// This suite is hermetic: it binds its own throwaway sockets and spawns nothing.

const net = require("net");
const { waitForPort, probe } = require("./lib/wait-for-server");

let failures = 0;

function check(label, ok, detail) {
  if (ok) {
    console.log(`  ok    ${label}`);
  } else {
    failures++;
    console.error(`  FAIL  ${label}${detail ? " - " + detail : ""}`);
  }
}

function listen(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer((socket) => socket.end());
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

// Ask the OS for a port, then release it. Small TOCTOU window, fine for a test.
function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

async function main() {
  console.log("Testing readiness polling (Test Seam 8)...");

  // 1. A server that binds 400ms late must still be found, and we must not
  //    return before it is actually up.
  const latePort = await freePort();
  const lateServer = new Promise((resolve, reject) => {
    setTimeout(() => {
      listen(latePort).then(resolve, reject);
    }, 400);
  });

  const t0 = Date.now();
  const foundLate = await waitForPort(latePort, { timeoutMs: 5000 });
  const lateWait = Date.now() - t0;
  check("finds a server that binds 400ms late", foundLate === true);
  check("waited for it rather than returning early", lateWait >= 350, `waited ${lateWait}ms`);
  check("probe() agrees the port is now open", (await probe(latePort)) === true);
  (await lateServer).close();

  // 2. A port that never opens must give up near the deadline, not hang and not
  //    report success.
  const deadPort = await freePort();
  const t1 = Date.now();
  const foundDead = await waitForPort(deadPort, { timeoutMs: 600, intervalMs: 25 });
  const deadWait = Date.now() - t1;
  check("gives up on a port that never opens", foundDead === false);
  check("gave up near the deadline, not immediately or never", deadWait >= 550 && deadWait < 2500, `waited ${deadWait}ms`);

  // 3. An already-open port must return promptly, not burn the full timeout.
  const openPort = await freePort();
  const openServer = await listen(openPort);
  const t2 = Date.now();
  const foundOpen = await waitForPort(openPort, { timeoutMs: 3000 });
  const openWait = Date.now() - t2;
  check("returns true for an already-open port", foundOpen === true);
  check("returned promptly rather than waiting out the timeout", openWait < 500, `waited ${openWait}ms`);
  openServer.close();

  if (failures) {
    console.error(`\nTest Seam 8: readiness polling FAILED (${failures} check${failures === 1 ? "" : "s"})\n`);
    process.exit(1);
  }
  console.log("\nTest Seam 8: readiness polling passed.\n");
  process.exit(0);
}

main().catch((err) => {
  console.error("Test Seam 8 crashed:", err && err.message);
  process.exit(1);
});
