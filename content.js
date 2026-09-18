// Browser Bridge Content Script
// Agent-agnostic: visual laser cursor, SoM tagging, human handshake, omnibar
// Dynamically adapts branding based on active agent

(function () {
  // Default branding (updated by AGENT_CHANGED message)
  let branding = {
    primaryColor: "#1D9E75",
    accentGradient: "linear-gradient(135deg, #1D9E75 0%, #5DCAA5 50%, #A0E8C5 100%)",
    dark: "#04342C",
    light: "#E1F5EE"
  };

  let agentName = "Browser Bridge";

  let container = null;
  let cursorEl = null;
  let badgeEl = null;
  let hideTimeout = null;
  let activeBadges = new Map();
  let somContainer = null;
  let omnibarWrapper = null;

  function initOverlay() {
    if (container) return;
    container = document.createElement("div");
    container.id = "bridge-cursor-container";

    cursorEl = document.createElement("div");
    cursorEl.id = "bridge-laser-cursor";
    cursorEl.innerHTML = `
      <svg viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="bridgeLaserGrad" x1="0" y1="0" x2="28" y2="28" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stop-color="#1D9E75"/>
            <stop offset="50%" stop-color="#5DCAA5"/>
            <stop offset="100%" stop-color="#A0E8C5"/>
          </linearGradient>
          <filter id="bridgeGlow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="1.5" result="blur"/>
            <feComposite in="SourceGraphic" in2="blur" operator="over"/>
          </filter>
        </defs>
        <path d="M4 2L24 13L15 15L12 24L4 2Z" fill="url(#bridgeLaserGrad)" filter="url(#bridgeGlow)" stroke="#ffffff" stroke-width="1.5" stroke-linejoin="round"/>
      </svg>
    `;

    badgeEl = document.createElement("div");
    badgeEl.id = "bridge-action-badge";

    container.appendChild(cursorEl);
    container.appendChild(badgeEl);

    const target = document.body || document.documentElement;
    if (target) target.appendChild(container);
  }

  function updateBranding(newBranding) {
    if (!newBranding) return;
    branding = newBranding;

    // Update CSS variables
    if (container) {
      container.style.setProperty("--bridge-primary", branding.primaryColor);
    }

    // Update cursor gradient if it exists
    if (cursorEl) {
      const grad = cursorEl.querySelector("#bridgeLaserGrad");
      if (grad) {
        const stops = grad.querySelectorAll("stop");
        if (stops.length >= 3) {
          stops[0].setAttribute("stop-color", branding.primaryColor);
          // Parse secondary from gradient string if available
          stops[1].setAttribute("stop-color", branding.secondaryColor || "#5DCAA5");
          stops[2].setAttribute("stop-color", branding.light || "#A0E8C5");
        }
      }
    }

    // Update omnibar if visible
    if (omnibarWrapper) {
      const header = omnibarWrapper.querySelector(".bridge-omnibar-header");
      if (header) {
        header.style.borderBottomColor = branding.primaryColor + "44";
      }
      const inputEl = omnibarWrapper.querySelector(".bridge-omnibar-input");
      if (inputEl) {
        inputEl.placeholder = `Ask ${agentName} to click, automate, or inspect this tab...`;
      }
    }
  }

  function showAction(x, y, label, isClick = false, state = "normal") {
    initOverlay();
    if (!container || !cursorEl) return;

    if (hideTimeout) clearTimeout(hideTimeout);

    cursorEl.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    cursorEl.classList.add("active");

    badgeEl.className = "active";
    if (state === "handshake") {
      badgeEl.classList.add("handshake");
    } else if (state === "guardrail") {
      badgeEl.classList.add("guardrail");
    }

    if (label) {
      badgeEl.textContent = label;
      const badgeX = Math.min(x + 22, window.innerWidth - 240);
      const badgeY = Math.max(12, y + 18);
      badgeEl.style.transform = `translate3d(${badgeX}px, ${badgeY}px, 0)`;
    } else {
      badgeEl.classList.remove("active");
    }

    if (isClick) {
      const ripple = document.createElement("div");
      ripple.className = "bridge-ripple";
      ripple.style.left = `${x}px`;
      ripple.style.top = `${y}px`;
      ripple.style.borderColor = branding.primaryColor;
      ripple.style.background = branding.primaryColor + "40";
      ripple.style.boxShadow = `0 0 12px ${branding.primaryColor}`;
      container.appendChild(ripple);
      setTimeout(() => ripple.remove(), 650);
    }

    const duration = state === "normal" ? 3500 : 15000;
    hideTimeout = setTimeout(() => {
      cursorEl.classList.remove("active");
      badgeEl.classList.remove("active");
    }, duration);
  }

  // --- Set-of-Mark (SoM) Interactive Tagging ---
  function tagElements() {
    clearTags();
    somContainer = document.createElement("div");
    somContainer.id = "bridge-som-container";

    function isVisible(el) {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return (
        rect.width > 8 &&
        rect.height > 8 &&
        rect.top < window.innerHeight &&
        rect.bottom > 0 &&
        rect.left < window.innerWidth &&
        rect.right > 0 &&
        style.visibility !== "hidden" &&
        style.display !== "none" &&
        style.opacity !== "0"
      );
    }

    const selectors = "button, a, input, select, textarea, [role='button'], [role='tab'], [role='menuitem'], [role='checkbox'], [role='link']";
    const candidates = Array.from(document.querySelectorAll(selectors)).filter(isVisible);

    const items = [];
    activeBadges.clear();

    candidates.slice(0, 99).forEach((el, index) => {
      const badgeId = index + 1;
      const rect = el.getBoundingClientRect();
      const badgeX = Math.max(0, Math.round(rect.left));
      const badgeY = Math.max(0, Math.round(rect.top - 12));

      const badge = document.createElement("div");
      badge.className = "bridge-som-badge";
      badge.textContent = badgeId;
      badge.style.left = `${badgeX}px`;
      badge.style.top = `${badgeY}px`;
      // Apply agent branding to badge
      badge.style.background = `linear-gradient(135deg, ${branding.dark} 0%, ${branding.primaryColor} 100%)`;
      badge.style.boxShadow = `0 2px 8px rgba(0, 0, 0, 0.45), 0 0 8px ${branding.primaryColor}99`;
      somContainer.appendChild(badge);

      const targetX = Math.round(rect.left + rect.width / 2);
      const targetY = Math.round(rect.top + rect.height / 2);

      const itemData = {
        badgeId,
        tag: el.tagName.toLowerCase(),
        text: (el.innerText || el.value || el.getAttribute("aria-label") || el.getAttribute("title") || "").trim().slice(0, 60),
        role: el.getAttribute("role") || undefined,
        type: el.getAttribute("type") || undefined,
        x: targetX,
        y: targetY
      };

      activeBadges.set(badgeId, { el, x: targetX, y: targetY, data: itemData });
      items.push(itemData);
    });

    const target = document.body || document.documentElement;
    if (target) target.appendChild(somContainer);

    return {
      taggedCount: items.length,
      elements: items
    };
  }

  function clearTags() {
    if (somContainer) {
      somContainer.remove();
      somContainer = null;
    }
    activeBadges.clear();
    return { cleared: true };
  }

  // Same rule as findElement: never measure while a scroll is still animating.
  // Badges are only created for elements already in the viewport, so the scroll is
  // usually a no-op - but when it does move, the rect read on the next line would
  // be stale and the click would land short.
  async function getBadge(id) {
    const entry = activeBadges.get(Number(id));
    if (!entry) return { found: false };
    entry.el.scrollIntoView({ block: "center", inline: "center" });
    await settleScroll(entry.el, 1200);
    const rect = entry.el.getBoundingClientRect();
    return {
      found: true,
      x: Math.round(rect.left + rect.width / 2),
      y: Math.round(rect.top + rect.height / 2),
      text: entry.data.text
    };
  }

  // --- Stealth Human Handshake (Anti-Bot & 2FA) ---
  function playAudioChime() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(587.33, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.25);
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.45);
    } catch (_) {}
  }

  function detectAntiBotChallenge() {
    const isCloudflare = Boolean(
      document.querySelector("iframe[src*='challenges.cloudflare.com'], div.cf-turnstile, #cf-challenge-running")
    );
    const isRecaptcha = Boolean(
      document.querySelector("iframe[src*='recaptcha'], div.g-recaptcha, #recaptcha")
    );
    const is2FA = Boolean(
      document.querySelector("[data-challengetype], input[autocomplete='one-time-code'], input[name*='otp'], input[name*='code']")
    );

    if (isCloudflare || isRecaptcha || is2FA) {
      const type = isCloudflare ? "Cloudflare Turnstile" : isRecaptcha ? "Google reCAPTCHA" : "2FA / OTP Challenge";
      playAudioChime();
      showAction(Math.round(window.innerWidth / 2), 60, `Human Verification Required: ${type}`, false, "handshake");
      return { challenged: true, type };
    }

    return { challenged: false };
  }

  // --- In-Page Floating AI Omnibar ---
  function initOmnibar() {
    if (omnibarWrapper) return;
    omnibarWrapper = document.createElement("div");
    omnibarWrapper.id = "bridge-omnibar-wrapper";

    omnibarWrapper.innerHTML = `
      <div id="bridge-omnibar">
        <div class="bridge-omnibar-header">
          <svg class="bridge-omnibar-icon" viewBox="0 0 24 24" fill="none" stroke="${branding.primaryColor}" stroke-width="2">
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
          </svg>
          <input type="text" class="bridge-omnibar-input" placeholder="Ask ${agentName} to click, automate, or inspect this tab..." />
          <span class="bridge-omnibar-kbd">ESC</span>
        </div>
        <div class="bridge-omnibar-chips">
          <button class="bridge-chip-btn" data-action="tag">Tag Viewport (SoM)</button>
          <button class="bridge-chip-btn" data-action="clear">Clear Badges</button>
          <button class="bridge-chip-btn" data-action="inspect">Inspect DOM</button>
          <button class="bridge-chip-btn" data-action="screenshot">Capture Tab</button>
        </div>
        <div class="bridge-omnibar-footer">
          <span class="bridge-agent-name">${agentName} Browser Bridge</span>
          <span>Shortcut: <b>Cmd+Shift+K</b></span>
        </div>
      </div>
    `;

    // Apply agent-specific border color
    const omnibar = omnibarWrapper.querySelector("#bridge-omnibar");
    if (omnibar) {
      omnibar.style.borderColor = branding.primaryColor + "66";
      omnibar.style.boxShadow = `0 20px 45px rgba(0, 0, 0, 0.6), 0 0 24px ${branding.primaryColor}40`;
    }

    const target = document.body || document.documentElement;
    if (target) target.appendChild(omnibarWrapper);

    const input = omnibarWrapper.querySelector(".bridge-omnibar-input");

    omnibarWrapper.addEventListener("click", (e) => {
      if (e.target === omnibarWrapper) hideOmnibar();
    });

    omnibarWrapper.querySelectorAll(".bridge-chip-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const act = btn.getAttribute("data-action");
        if (act === "tag") tagElements();
        if (act === "clear") clearTags();
        if (act === "inspect") {
          const dom = extractDOM();
          console.log("[Browser Bridge Omnibar] DOM Summary:", dom);
        }
        hideOmnibar();
      });
    });

    input.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        hideOmnibar();
      } else if (e.key === "Enter" && input.value.trim()) {
        const prompt = input.value.trim();
        hideOmnibar();
        showAction(Math.round(window.innerWidth / 2), 40, `Processing: "${prompt.slice(0, 35)}..."`);

        // Send to active agent's bridge
        const bridgeUrl = window.__bridgeAgentHttpUrl || "http://127.0.0.1:8766";
        fetch(`${bridgeUrl}/omnibar/prompt`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt, url: window.location.href, title: document.title })
        }).catch(() => {});
      }
    });
  }

  function toggleOmnibar() {
    initOmnibar();
    if (!omnibarWrapper) return;
    const isVisible = omnibarWrapper.classList.contains("visible");
    if (isVisible) {
      hideOmnibar();
    } else {
      omnibarWrapper.classList.add("visible");
      const input = omnibarWrapper.querySelector(".bridge-omnibar-input");
      if (input) {
        input.value = "";
        setTimeout(() => input.focus(), 80);
      }
    }
  }

  function hideOmnibar() {
    if (omnibarWrapper) {
      omnibarWrapper.classList.remove("visible");
    }
  }

  window.addEventListener("keydown", (e) => {
    // Cmd+Shift+K (Mac) or Ctrl+Shift+K (Win/Linux)
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "k") {
      e.preventDefault();
      toggleOmnibar();
    }
  });

  // --- Element finding: measure -> verify -> only then report coordinates ---
  //
  // Three rules, each learned from a real misclick:
  //
  //   1. WAIT FOR THE SCROLL. scrollIntoView animates whenever `behavior: "smooth"`
  //      is passed OR the page sets `scroll-behavior: smooth` on the root. Reading
  //      getBoundingClientRect on the next line returns the position from BEFORE the
  //      scroll, so the reported point is stale by hundreds of pixels - measured at
  //      2475px on a below-the-fold target, which put the click outside the viewport
  //      entirely. Measure only once the rect has stopped moving.
  //   2. PICK THE SMALLEST MATCH. querySelectorAll(...).find() returns whatever the
  //      DOM yields first, which is usually a large wrapper containing the real
  //      control. Exact matches beat partial ones; within a tier the smallest visible
  //      element wins.
  //   3. VERIFY THE POINT IS REACHABLE. elementFromPoint must actually return the
  //      target (or a descendant). Otherwise a sticky header, modal or overlay sits on
  //      top and the click would land on that instead. Only a point proven to hit the
  //      target is ever reported.
  //
  // Open shadow roots and same-origin iframes are searched too. A framed element
  // reports its rect in the FRAME's coordinate space, so its offset travels with it
  // and is added back before the coordinates are returned.
  const MAX_FRAME_DEPTH = 4;

  function matchableText(el) {
    const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
    const direct = norm(el.innerText || el.textContent);
    if (direct) return direct;
    if (typeof el.value === "string" && el.value.trim()) return el.value.trim();
    return norm(
      [el.getAttribute("aria-label"), el.getAttribute("title"), el.getAttribute("placeholder")]
        .filter(Boolean)
        .join(" ")
    );
  }

  function collectCandidates(root, acc, depth, doc, vw, vh, inFrame) {
    if (depth > MAX_FRAME_DEPTH) return acc;
    const selectors =
      "button, a, [role='button'], [role='menuitem'], [role='tab'], span, h1, h2, h3, h4, " +
      "th, td, label, input[type=submit], input[type=button]";
    try {
      root.querySelectorAll(selectors).forEach((el) => acc.push({ el, doc, vw, vh, inFrame }));
    } catch (_) {}
    try {
      root.querySelectorAll("*").forEach((el) => {
        if (el.shadowRoot) {
          collectCandidates(el.shadowRoot, acc, depth + 1, doc, vw, vh, inFrame);
        }
        if (el.tagName === "IFRAME") {
          try {
            const d = el.contentDocument;
            if (!d || !el.contentWindow) return;
            collectCandidates(
              d, acc, depth + 1, d,
              el.contentWindow.innerWidth, el.contentWindow.innerHeight, true
            );
          } catch (_) {}
        }
      });
    } catch (_) {}
    return acc;
  }

  // Where an element's frame sits in TOP-LEVEL viewport coordinates, summed across
  // nested frames. Computed on demand rather than cached at collection time: a frame
  // moves whenever the page scrolls, so a cached offset goes stale the moment we
  // scroll the target into view - which is exactly when we need it.
  function pageOffsetOf(el) {
    const chain = [];
    let view = el.ownerDocument && el.ownerDocument.defaultView;
    while (view && view !== window) {
      let fe = null;
      try { fe = view.frameElement; } catch (_) { break; }
      if (!fe) break;
      chain.push(fe);
      view = view.parent;
    }
    let ox = 0;
    let oy = 0;
    // outermost first: each frame's rect is expressed in its own parent's space
    for (let i = chain.length - 1; i >= 0; i--) {
      const r = chain[i].getBoundingClientRect();
      ox += r.left;
      oy += r.top;
    }
    return { x: ox, y: oy };
  }

  function scoreCandidate(rec, want) {
    const text = matchableText(rec.el).toLowerCase();
    const aria = (rec.el.getAttribute("aria-label") || "").toLowerCase();
    const exact = text === want || aria === want;
    const partial = text.includes(want) || aria.includes(want);
    if (!exact && !partial) return null;
    let r, cs;
    try {
      r = rec.el.getBoundingClientRect();
      const view = (rec.doc && rec.doc.defaultView) || window;
      cs = view.getComputedStyle(rec.el);
    } catch (_) {
      return null;
    }
    if (r.width <= 0 || r.height <= 0) return null;
    if (cs.visibility === "hidden" || cs.display === "none" || cs.opacity === "0") return null;
    rec.r = r;
    rec.exact = exact;
    rec.area = r.width * r.height;
    return rec;
  }

  // elementFromPoint returns the shadow HOST for points inside a shadow tree, so
  // descend until the result stops changing - otherwise an inner button looks
  // permanently occluded by its own host.
  function deepHit(doc, x, y) {
    let el = null;
    try { el = doc.elementFromPoint(x, y); } catch (_) { return null; }
    let guard = 0;
    while (el && el.shadowRoot && guard++ < 10) {
      let inner = null;
      try { inner = el.shadowRoot.elementFromPoint(x, y); } catch (_) { break; }
      if (!inner || inner === el) break;
      el = inner;
    }
    return el;
  }

  function inTree(el, node) {
    let n = node;
    while (n) {
      if (n === el) return true;
      n = n.parentNode || n.host || null;
    }
    return false;
  }

  function hitsTarget(rec, x, y) {
    const hit = deepHit(rec.doc, x, y);
    return !!hit && inTree(rec.el, hit);
  }

  // Probe in the element's own frame, then translate the winning point to page
  // coordinates and re-check it against the top-level viewport.
  function clickPointFor(rec) {
    const r = rec.r;
    const off = pageOffsetOf(rec.el);
    const xs = [r.left + r.width / 2, r.left + r.width * 0.25, r.left + r.width * 0.75,
                r.left + 2, r.right - 2];
    const ys = [r.top + r.height / 2, r.top + r.height * 0.25, r.top + r.height * 0.75,
                r.top + 2, r.bottom - 2];
    for (const y of ys) {
      for (const x of xs) {
        if (x < 1 || y < 1 || x > rec.vw - 1 || y > rec.vh - 1) continue;
        if (!hitsTarget(rec, x, y)) continue;
        const px = x + off.x, py = y + off.y;
        if (px < 1 || py < 1 || px > window.innerWidth - 1 || py > window.innerHeight - 1) continue;
        return { x: Math.round(px), y: Math.round(py) };
      }
    }
    return null;
  }

  // Resolve once the rect stops moving, so an animated scroll cannot be measured
  // mid-flight. Bounded by a timeout - a target that never settles still gets an
  // answer rather than hanging the click.
  function settleScroll(el, timeoutMs) {
    return new Promise((resolve) => {
      const start = Date.now();
      let last = null;
      let stable = 0;
      const tick = () => {
        let top;
        try { top = el.getBoundingClientRect().top; } catch (_) { return resolve(false); }
        if (last !== null && Math.abs(top - last) < 0.5) stable++;
        else stable = 0;
        last = top;
        if (stable >= 2) return resolve(true);
        if (Date.now() - start > timeoutMs) return resolve(false);
        setTimeout(tick, 32);
      };
      setTimeout(tick, 32);
    });
  }

  // scrollIntoView on a framed element scrolls the frame, but the frame itself may
  // still sit outside the top-level viewport.
  function hoistAncestorFrames(el) {
    const chain = [];
    let view = el.ownerDocument && el.ownerDocument.defaultView;
    while (view && view !== window) {
      try { chain.push(view.frameElement); } catch (_) { break; }
      view = view.parent;
    }
    chain.forEach((fe) => {
      if (!fe) return;
      const r = fe.getBoundingClientRect();
      if (r.top < 0 || r.bottom > window.innerHeight) {
        try { fe.scrollIntoView({ block: "center" }); } catch (_) {}
      }
    });
  }

  function describeMatch(rec, cp) {
    return {
      found: true,
      x: cp.x,
      y: cp.y,
      tag: rec.el.tagName,
      text: matchableText(rec.el).slice(0, 100),
      verified: true
    };
  }

  async function findElement(query) {
    if (!query) return { found: false };

    if (query.selector) {
      try {
        const el = document.querySelector(query.selector);
        if (el) {
          el.scrollIntoView({ block: "center", inline: "center" });
          await settleScroll(el, 1200);
          const r = el.getBoundingClientRect();
          // Prefer a point proven to reach the element; fall back to the measured
          // centre for callers that rely on getting an answer either way.
          const rec = {
            el, r, doc: document, vw: window.innerWidth, vh: window.innerHeight
          };
          const cp = clickPointFor(rec);
          return {
            found: true,
            x: cp ? cp.x : Math.round(r.left + r.width / 2),
            y: cp ? cp.y : Math.round(r.top + r.height / 2),
            tag: el.tagName,
            text: matchableText(el).slice(0, 100),
            verified: !!cp
          };
        }
      } catch (_) {}
    }

    const want = (query.text || query.aria || "").trim().toLowerCase();
    if (!want) return { found: false };

    const all = collectCandidates(
      document, [], 0, document, window.innerWidth, window.innerHeight, false
    );

    const scored = [];
    for (const rec of all) {
      if (scoreCandidate(rec, want)) scored.push(rec);
    }
    scored.sort((a, b) => (b.exact - a.exact) || (a.area - b.area));

    // Only ever act on the best match. Falling through to a runner-up is how a click
    // ends up on the wrong element - a wrong click is worse than no click.
    const best = scored[0];
    if (!best) return { found: false };

    // Already reachable? Report the verified point without moving the page.
    let cp = clickPointFor(best);
    if (cp) return describeMatch(best, cp);

    // Not reachable - most likely below the fold. Scroll it in, wait for the scroll
    // to settle, then RE-MEASURE: the rect captured during scoring is stale after
    // any scroll, and probing a stale rect is the same class of bug this guards.
    try { best.el.scrollIntoView({ block: "center", inline: "center" }); } catch (_) {}
    await settleScroll(best.el, 1200);
    hoistAncestorFrames(best.el);
    await settleScroll(best.el, 1200);
    try { best.r = best.el.getBoundingClientRect(); } catch (_) { return { found: false }; }
    cp = clickPointFor(best);
    if (cp) return describeMatch(best, cp);

    // Genuinely unreachable: covered by a sticky header, modal or overlay. Decline
    // instead of guessing - the caller must not fire a click that lands elsewhere.
    return { found: false };
  }

  function extractDOM() {
    function isVisible(e) {
      return !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length) && window.getComputedStyle(e).visibility !== "hidden";
    }

    const interactiveSelectors = "button, a, input, select, textarea, [role='button'], [role='menuitem'], [role='tab'], [role='checkbox'], [role='link']";
    const elements = Array.from(document.querySelectorAll(interactiveSelectors)).filter(isVisible);

    const items = elements.slice(0, 80).map(el => {
      const rect = el.getBoundingClientRect();
      return {
        tag: el.tagName,
        type: el.getAttribute("type") || undefined,
        role: el.getAttribute("role") || undefined,
        text: (el.innerText || el.value || el.getAttribute("aria-label") || "").trim().slice(0, 80),
        x: Math.round(rect.left + rect.width / 2),
        y: Math.round(rect.top + rect.height / 2),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      };
    });

    return {
      title: document.title,
      url: window.location.href,
      headings: Array.from(document.querySelectorAll("h1, h2, h3")).filter(isVisible).map(h => h.innerText.trim()).slice(0, 10),
      elements: items
    };
  }

  // Chrome Runtime Message Listener
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "SHOW_ACTION") {
      if (request.agentBranding) {
        updateBranding(request.agentBranding);
      }
      showAction(request.x, request.y, request.label, request.isClick, request.state || "normal");
      sendResponse({ success: true });
    } else if (request.action === "AGENT_CHANGED") {
      if (request.agent) {
        agentName = request.agent.shortName || request.agent.name || "Browser Bridge";
        if (request.agent.branding) {
          updateBranding(request.agent.branding);
        }
        if (request.agent.httpUrl) {
          window.__bridgeAgentHttpUrl = request.agent.httpUrl;
        }
      }
      sendResponse({ success: true });
    } else if (request.action === "FIND_ELEMENT") {
      // findElement is async: it waits for a scroll to settle before measuring.
      // The trailing `return true` keeps the message channel open for this reply.
      findElement(request.query)
        .then(sendResponse)
        .catch(() => sendResponse({ found: false }));
    } else if (request.action === "EXTRACT_DOM") {
      sendResponse(extractDOM());
    } else if (request.action === "TAG_ELEMENTS") {
      sendResponse(tagElements());
    } else if (request.action === "CLEAR_TAGS") {
      sendResponse(clearTags());
    } else if (request.action === "GET_BADGE") {
      getBadge(request.badgeId)
        .then(sendResponse)
        .catch(() => sendResponse({ found: false }));
    } else if (request.action === "DETECT_CHALLENGE") {
      sendResponse(detectAntiBotChallenge());
    } else if (request.action === "TOGGLE_OMNIBAR") {
      toggleOmnibar();
      sendResponse({ success: true });
    }
    return true;
  });

  initOverlay();
})();
