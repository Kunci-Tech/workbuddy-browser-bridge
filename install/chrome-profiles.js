// Chrome profile scanner for the doctor.
//
// The bridge can only work if the unpacked extension is loaded in a Chrome
// profile — and Chrome keeps that fact in `Secure Preferences` inside each
// profile folder, not anywhere the bridge can ask about over the wire.
//
// That gap is why "the extension is not connected" is such a frustrating
// message: it is produced by the same code path whether the extension was
// never loaded, was loaded into a profile you don't have open, was loaded
// disabled, or was loaded from the wrong folder entirely.
//
// This module answers the question directly: which unpacked extensions does
// Chrome actually have, and in which profile?
//
// Everything here is best-effort and read-only. If Chrome isn't installed, or
// a profile file is unreadable or malformed, we return what we have rather
// than throwing — the doctor must still produce a verdict.

const fs = require("fs");
const os = require("os");
const path = require("path");

// Chrome's Extension::Location enum. 4 == LOAD_UNPACKED, which is what
// "Load unpacked" produces and the only thing the bridge can use.
const LOCATION_UNPACKED = 4;

// Profile folders Chrome creates. `Default` and `Profile N` are the ones a
// human can actually load an extension into; the others are noise but cheap
// to include.
const PROFILE_DIR_RE = /^(Default|Profile \d+|Guest Profile|System Profile)$/;

// Preference files, in priority order. Chrome moved extension settings into
// `Secure Preferences` (it is HMAC-signed); `Preferences` is the older home
// and still carries some entries.
const PREF_FILES = ["Secure Preferences", "Preferences"];

// Chrome-family browsers we know how to find. Chromium and Canary are included
// because a developer machine often has more than one installed, and the
// extension has to be loaded into whichever one you actually browse in.
function userDataDirs() {
  const home = os.homedir();
  const platform = process.platform;
  const candidates = [];

  const push = (browser, dir) => candidates.push({ browser, dir });

  if (platform === "darwin") {
    const base = path.join(home, "Library", "Application Support");
    push("Chrome", path.join(base, "Google", "Chrome"));
    push("Chrome Canary", path.join(base, "Google", "Chrome Canary"));
    push("Chromium", path.join(base, "Chromium"));
  } else if (platform === "win32") {
    const local = process.env.LOCALAPPDATA || path.join(home, "AppData", "Local");
    push("Chrome", path.join(local, "Google", "Chrome", "User Data"));
    push("Chrome Canary", path.join(local, "Google", "Chrome SxS", "User Data"));
    push("Chromium", path.join(local, "Chromium", "User Data"));
  } else {
    const config = process.env.XDG_CONFIG_HOME || path.join(home, ".config");
    push("Chrome", path.join(config, "google-chrome"));
    push("Chrome Canary", path.join(config, "google-chrome-unstable"));
    push("Chromium", path.join(config, "chromium"));
  }

  return candidates.filter((c) => {
    try {
      return fs.statSync(c.dir).isDirectory();
    } catch (_) {
      return false;
    }
  });
}

function profileDirs(userDataDir) {
  let names;
  try {
    names = fs.readdirSync(userDataDir);
  } catch (_) {
    return [];
  }
  return names
    .filter((n) => PROFILE_DIR_RE.test(n))
    .sort()
    .map((n) => path.join(userDataDir, n))
    .filter((d) => {
      try {
        return fs.statSync(d).isDirectory();
      } catch (_) {
        return false;
      }
    });
}

function readJson(file) {
  try {
    const raw = fs.readFileSync(file, "utf8").trim();
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}

// The manifest can arrive either already parsed (`manifest`) or as a raw JSON
// string (`manifest.json`) depending on how Chrome persisted the entry.
function manifestOf(entry) {
  if (entry.manifest && typeof entry.manifest === "object") return entry.manifest;
  const raw = entry["manifest.json"];
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch (_) {
      return {};
    }
  }
  return {};
}

// Chrome omits `state` entirely when an extension is enabled, and sets it to 0
// when disabled. `disable_reasons` is the other way an extension ends up off.
function isEnabled(entry) {
  const reasons = entry.disable_reasons;
  if (Array.isArray(reasons) && reasons.length > 0) return false;
  return entry.state !== 0;
}

// Chrome usually stores the manifest inline, but not always — and the inline
// copy can be missing for entries it has not re-read since install. Reading the
// folder on disk gives us a real name and version either way, which is what
// makes the doctor's output identifiable at a glance.
function diskManifest(extPath) {
  if (!extPath) return {};
  try {
    return JSON.parse(fs.readFileSync(path.join(extPath, "manifest.json"), "utf8"));
  } catch (_) {
    return {};
  }
}

// Collect unpacked extensions for one profile, merging the two preference
// files by extension id with `Secure Preferences` winning.
function unpackedInProfile(browser, profileDir) {
  const byId = new Map();

  for (const prefFile of PREF_FILES) {
    const cfg = readJson(path.join(profileDir, prefFile));
    const settings = cfg && cfg.extensions && cfg.extensions.settings;
    if (!settings || typeof settings !== "object") continue;

    for (const [id, entry] of Object.entries(settings)) {
      if (!entry || typeof entry !== "object") continue;
      if (entry.location !== LOCATION_UNPACKED) continue;

      const extPath = typeof entry.path === "string" ? entry.path : null;
      // Inline manifest wins when present; the on-disk copy fills the gaps.
      const manifest = { ...diskManifest(extPath), ...manifestOf(entry) };

      byId.set(id, {
        browser,
        profile: path.basename(profileDir),
        id,
        path: extPath,
        name: typeof manifest.name === "string" ? manifest.name : null,
        version: typeof manifest.version === "string" ? manifest.version : null,
        enabled: isEnabled(entry),
        source: prefFile
      });
    }
  }

  return [...byId.values()];
}

// `overrideDirs` exists so tests can point the scanner at a fixture instead of
// the real browser profiles on the machine. It takes the same shape as
// `userDataDirs()`: `[{ browser, dir }]`.
function scanUnpackedExtensions(overrideDirs) {
  const found = [];
  const browsers = [];
  const dirs = Array.isArray(overrideDirs) ? overrideDirs : userDataDirs();

  for (const { browser, dir } of dirs) {
    browsers.push(browser);
    for (const profileDir of profileDirs(dir)) {
      found.push(...unpackedInProfile(browser, profileDir));
    }
  }

  return { extensions: found, browsers };
}

// Decide which unpacked extensions are "ours" and which merely look like ours.
//
// Path match against the checkout is the reliable signal. The manifest-name
// match is a fallback for the case where the extension was loaded from a copy
// that has since moved. Look-alikes matter because a sibling project (for
// example an older Antigravity-only build) produces a near-identical name and
// is easy to load by mistake — which fails in a way that looks like a broken
// install.
function classify(extensions, projectRoot, ourManifestName) {
  const root = path.resolve(projectRoot);
  const ours = [];
  const lookalikes = [];

  for (const ext of extensions) {
    let samePath = false;
    if (ext.path) {
      try {
        samePath = path.resolve(ext.path) === root;
      } catch (_) {
        samePath = false;
      }
    }
    const sameName = Boolean(ourManifestName) && ext.name === ourManifestName;

    if (samePath || sameName) {
      ours.push({ ...ext, samePath });
      continue;
    }

    const looksRelated =
      /bridge/i.test(ext.name || "") ||
      /bridge|browser-extension/i.test(path.basename(ext.path || ""));
    if (looksRelated) lookalikes.push(ext);
  }

  return { ours, lookalikes };
}

// Human-readable "Profile 12 (Chrome)" style label.
function describe(ext) {
  return `${ext.profile} (${ext.browser})`;
}

module.exports = {
  LOCATION_UNPACKED,
  scanUnpackedExtensions,
  classify,
  describe
};
