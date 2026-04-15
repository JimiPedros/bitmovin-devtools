/**
 * injector.js — Content Script (isolated world).
 *
 * Responsibilities:
 *  1. Inject hook.js into the PAGE world so it can access window.bitmovin.
 *  2. Listen for postMessage events from hook.js and relay them to the
 *     background service worker via chrome.runtime.sendMessage.
 *  3. Forward BITMOVIN_COMMAND messages from the background to the page.
 */

(function () {
  "use strict";

  // ── 1. Inject the hook script into the page context ──────────────────────
  const script = document.createElement("script");
  script.src = chrome.runtime.getURL("content/hook.js");
  script.type = "text/javascript";
  (document.head || document.documentElement).appendChild(script);
  script.remove(); // Clean up the tag after injection

  // ── 2. Relay page → extension messages ────────────────────────────────────
  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const msg = event.data;
    if (!msg || msg.source !== "__bitmovin_hook__") return;

    // Strip the internal 'source' marker before forwarding.
    const { source, ...payload } = msg;

    chrome.runtime.sendMessage(payload).catch(() => {
      // Background may not be ready yet — ignore
    });
  });

  // ── 3. Forward commands from background → page ────────────────────────────
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "BITMOVIN_COMMAND") {
      window.postMessage(message, "*");
    }
  });
})();
