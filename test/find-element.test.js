// Test Seam: element finding must measure safely.
//
// Guards the coordinate bugs fixed in content.js:
//
//   1. STATIC  - no scrollIntoView may be measured before it has settled. The
//                original code read getBoundingClientRect() on the line directly
//                after an animated scrollIntoView, returning pre-scroll coordinates.
//                Measured error on a below-the-fold target: 2475px, which placed the
//                click outside the viewport entirely.
//   2. STATIC  - the safety machinery must still be present (occlusion
//                verification, shadow-root descent, iframe coordinate offsets,
//                exact-over-partial + smallest-visible scoring).
//   3. RUNTIME - settleScroll is extracted from content.js and run against a fake
//                element whose rect moves and then stops. It must not resolve while
//                the rect is still moving, and must resolve once it is stable.
//
// This cannot cover the DOM-dependent logic (selection, occlusion) - that needs a
// real browser. Run the live fixture test for that; see the README.

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT_DIR = path.resolve(__dirname, "..");
const CONTENT_PATH = path.join(ROOT_DIR, "content.js");
const CONTENT = fs.readFileSync(CONTENT_PATH, "utf8");

let errors = [];
const check = (cond, msg) => { if (!cond) errors.push(msg); };

console.log("Testing element-finding coordinate safety...");

// --- 1. No scrollIntoView may be measured before it settles -------------------

const lines = CONTENT.split("\n");
const isSignificant = (s) => {
  const t = s.trim();
  return t !== "" && !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
};

let staleSites = [];
for (let i = 0; i < lines.length; i++) {
  if (!lines[i].includes("scrollIntoView(")) continue;
  // Look at the next few significant lines for an unguarded rect read.
  let seen = 0;
  for (let j = i + 1; j < lines.length && seen < 3; j++) {
    if (!isSignificant(lines[j])) continue;
    seen++;
    const l = lines[j];
    if (/await\s+settleScroll|settleScroll\(/.test(l)) break; // guarded
    if (/getBoundingClientRect\(\)/.test(l)) {
      staleSites.push(i + 1);
      break;
    }
  }
}
check(
  staleSites.length === 0,
  `Stale-coordinate pattern at content.js line(s) ${staleSites.join(", ")}: ` +
    `getBoundingClientRect() is read before the preceding scrollIntoView has settled. ` +
    `Animated scrolls are asynchronous - await settleScroll() first.`
);

// --- 2. The safety machinery must still be present ----------------------------

const REQUIRED = [
  ["elementFromPoint", "occlusion verification (elementFromPoint)"],
  ["shadowRoot.elementFromPoint", "shadow-root descent in the hit test"],
  ["n.host", "ancestor walk that crosses the shadow boundary"],
  ["pageOffsetOf", "frame-offset computation"],
  ["ox += r.left", "summing the frame chain's offsets"],
  ["settleScroll", "settle-aware scroll measurement"],
  ["deepHit", "deep hit test"],
  ["hitsTarget", "hit verification"],
  ["b.exact - a.exact", "exact-over-partial ranking"],
  ["a.area - b.area", "smallest-visible-element ranking"],
  ["async function findElement", "findElement must be async (it awaits the scroll)"]
];
for (const [needle, label] of REQUIRED) {
  check(CONTENT.includes(needle), `Missing ${label} - expected to find ${JSON.stringify(needle)}`);
}

// Both handlers must await their async producer rather than replying synchronously.
for (const [name, label] of [["findElement", "FIND_ELEMENT"], ["getBadge", "GET_BADGE"]]) {
  check(
    !CONTENT.includes(`sendResponse(${name}(`),
    `${label} handler still replies synchronously - it must await the async ${name}()`
  );
}
check(
  CONTENT.includes(".then(sendResponse)"),
  "Async handlers must reply via .then(sendResponse) to keep the message channel open"
);

// --- 3. settleScroll must actually wait for stability -------------------------

function extractFunction(src, name) {
  const start = src.indexOf("function " + name + "(");
  if (start < 0) return null;
  const open = src.indexOf("{", start);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  return null;
}

const settleSrc = extractFunction(CONTENT, "settleScroll");
if (!settleSrc) {
  errors.push("Could not extract settleScroll() from content.js");
} else {
  const ctx = { setTimeout, clearTimeout, Date, Math, Promise };
  vm.createContext(ctx);
  try {
    vm.runInContext(settleSrc, ctx);
  } catch (e) {
    errors.push(`settleScroll() failed to evaluate: ${e.message}`);
  }

  if (typeof ctx.settleScroll === "function") {
    const settleScroll = ctx.settleScroll;

    (async () => {
      // (a) a rect that moves then stops -> must wait for the stop
      const positions = [1000, 900, 500, 472, 472, 472, 472];
      let i = 0;
      const moving = {
        getBoundingClientRect: () => ({ top: positions[Math.min(i++, positions.length - 1)] })
      };
      const started = Date.now();
      const settled = await settleScroll(moving, 3000);
      const elapsed = Date.now() - started;

      check(settled === true, "settleScroll should resolve true once the rect is stable");
      check(i >= 4, `settleScroll resolved after only ${i} sample(s) - it must observe stability`);
      check(elapsed >= 90, `settleScroll returned in ${elapsed}ms - too early to have seen a settle`);

      // (b) a rect that never stops -> must give up at the timeout, not hang
      let j = 0;
      const always = { getBoundingClientRect: () => ({ top: 1000 + j++ * 50 }) };
      const t0 = Date.now();
      const gaveUp = await settleScroll(always, 250);
      const waited = Date.now() - t0;
      check(gaveUp === false, "settleScroll should resolve false when the rect never settles");
      check(waited >= 200, `settleScroll gave up after ${waited}ms - expected to honour the timeout`);
      check(waited < 2000, `settleScroll took ${waited}ms - the timeout is not being applied`);

      report();
    })();
  } else {
    report();
  }
}

function report() {
  if (errors.length > 0) {
    console.error(`\nElement-finding safety FAILED (${errors.length} issue(s)):`);
    errors.forEach((e) => console.error("  -", e));
    process.exit(1);
  }
  console.log(
    "Element-finding safety PASSED! No stale-coordinate sites, safety machinery present, " +
      "settleScroll waits for stability and honours its timeout.\n"
  );
  process.exit(0);
}
