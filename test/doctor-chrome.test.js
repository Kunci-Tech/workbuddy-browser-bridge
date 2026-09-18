// Test Seam 7: Chrome profile scanning for the doctor
//
// The doctor's whole value is telling "the install is broken" apart from "the
// human hasn't finished yet". Before this module existed it could not see
// Chrome at all, so "extension never loaded", "extension loaded into a profile
// you don't have open" and "extension loaded disabled" all produced the same
// message. These cases are pinned here so that stays fixed.

const fs = require("fs");
const os = require("os");
const path = require("path");

const { scanUnpackedExtensions, classify, describe } = require("../install/chrome-profiles");

const OUR_NAME = "Browser Bridge for AI Agents";
const DECOY_NAME = "Antigravity Browser Bridge";

let failures = 0;

function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    console.log(`  ok    ${label}`);
  } else {
    failures++;
    console.error(`  FAIL  ${label}`);
    console.error(`        expected ${JSON.stringify(expected)}`);
    console.error(`        received ${JSON.stringify(actual)}`);
  }
}

// --- Fixture ------------------------------------------------------------------

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bb-chrome-"));
const chromeDir = path.join(tmp, "Chrome");
const oursPath = path.join(tmp, "workbuddy-browser-bridge");
const decoyPath = path.join(tmp, "antigravity-browser-extension");
const stalePath = path.join(tmp, "old-clone", "workbuddy-browser-bridge");

function writeProfile(profile, settings) {
  const dir = path.join(chromeDir, profile);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "Secure Preferences"),
    JSON.stringify({ extensions: { settings } })
  );
}

function writeManifest(extPath, name, version) {
  fs.mkdirSync(extPath, { recursive: true });
  fs.writeFileSync(path.join(extPath, "manifest.json"), JSON.stringify({ name, version }));
}

// Chrome persists unpacked extensions as location 4 and omits `state` when the
// extension is enabled, setting it to 0 when disabled.
const unpacked = (extPath) => ({ location: 4, path: extPath });

writeManifest(oursPath, OUR_NAME, "2.0.0");
writeManifest(decoyPath, DECOY_NAME, "1.0.0");
writeManifest(stalePath, OUR_NAME, "1.9.0");

// The realistic failure: ours is loaded, but into a profile the user does not
// have open, while an older sibling project sits in Default. Profile 6 covers
// the "loaded from a copy that has since moved" case.
writeProfile("Default", { decoyid: unpacked(decoyPath) });
writeProfile("Profile 12", { oursid: unpacked(oursPath) });
writeProfile("Profile 3", { disabledid: { ...unpacked(oursPath), state: 0 } });
writeProfile("Profile 4", {});
writeProfile("Profile 6", { staleid: unpacked(stalePath) });

console.log("Scanning fixture Chrome profiles\n");

const scan = scanUnpackedExtensions([{ browser: "Chrome", dir: chromeDir }]);

check("finds only unpacked extensions", scan.extensions.length, 4);
check("reports the browser it scanned", scan.browsers, ["Chrome"]);
check(
  "reads names from the folder when Chrome prefs omit them",
  scan.extensions.map((e) => e.name).sort(),
  [DECOY_NAME, OUR_NAME, OUR_NAME, OUR_NAME].sort()
);
check(
  "treats a missing state as enabled",
  scan.extensions.filter((e) => e.enabled).length,
  3
);

const { ours, lookalikes } = classify(scan.extensions, oursPath, OUR_NAME);
check("identifies our extension wherever it is loaded", ours.length, 3);
check("identifies the sibling project as a look-alike", lookalikes.length, 1);
check("names the look-alike", lookalikes[0].name, DECOY_NAME);
check("labels profile and browser", describe(ours[0]), "Profile 12 (Chrome)");
check(
  "flags a copy loaded from outside this checkout",
  ours.some((e) => e.samePath === true) && ours.some((e) => e.samePath === false),
  true
);

// --- Degradation --------------------------------------------------------------
// The doctor must still produce a verdict on machines with no Chrome at all.

const empty = scanUnpackedExtensions([{ browser: "Chrome", dir: path.join(tmp, "nope") }]);
check("missing browser dir yields no extensions", empty.extensions.length, 0);
check("missing browser dir still reports the browser", empty.browsers, ["Chrome"]);

const nothing = classify([], oursPath, OUR_NAME);
check("classifying nothing yields no ours", nothing.ours.length, 0);
check("classifying nothing yields no look-alikes", nothing.lookalikes.length, 0);

// A malformed preferences file must not throw.
const brokenDir = path.join(chromeDir, "Profile 5");
fs.mkdirSync(brokenDir, { recursive: true });
fs.writeFileSync(path.join(brokenDir, "Secure Preferences"), "{ not json");
const afterBroken = scanUnpackedExtensions([{ browser: "Chrome", dir: chromeDir }]);
check("malformed preferences are skipped, not fatal", afterBroken.extensions.length, 4);

fs.rmSync(tmp, { recursive: true, force: true });

if (failures > 0) {
  console.error(`\nTest Seam 7: Chrome profile scanning FAILED (${failures} assertion(s)).`);
  process.exit(1);
}

console.log("\nTest Seam 7: Chrome profile scanning passed.\n");
