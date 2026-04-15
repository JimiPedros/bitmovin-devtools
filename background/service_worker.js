/**
 * Background Service Worker
 *
 * Acts as a message relay between:
 *   content/hook.js  (page context — captures Bitmovin events)
 *   content/injector.js (content script — bridges page ↔ extension)
 *   panel/panel.js   (DevTools panel — displays events)
 *
 * Message flow:
 *   page  →[window.postMessage]→  injector  →[chrome.runtime.sendMessage]→
 *   service_worker  →[port.postMessage]→  panel
 */

// tabId → DevTools panel port
const devtoolsPorts = new Map();

// tabId → buffered events (for when the panel isn't open yet)
const eventBuffers = new Map();
const MAX_BUFFER = 500;

// ── DevTools panel connects via chrome.runtime.connect ──────────────────────
chrome.runtime.onConnect.addListener((port) => {
  if (!port.name.startsWith("bitmovin-devtools-")) return;

  const tabId = parseInt(port.name.split("-").pop(), 10);
  devtoolsPorts.set(tabId, port);

  // Flush any buffered events to the newly opened panel
  const buffer = eventBuffers.get(tabId) || [];
  if (buffer.length > 0) {
    port.postMessage({ type: "BULK_EVENTS", events: buffer });
    eventBuffers.delete(tabId);
  }

  port.onDisconnect.addListener(() => {
    devtoolsPorts.delete(tabId);
  });
});

// ── Content script sends events via chrome.runtime.sendMessage ───────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!sender.tab) return;
  const tabId = sender.tab.id;

  if (message.type === "BITMOVIN_EVENT") {
    const port = devtoolsPorts.get(tabId);
    if (port) {
      try {
        port.postMessage(message);
      } catch (e) {
        // Panel was closed — buffer it
        bufferEvent(tabId, message);
      }
    } else {
      bufferEvent(tabId, message);
    }
  }

  if (message.type === "BITMOVIN_PLAYER_FOUND") {
    const port = devtoolsPorts.get(tabId);
    if (port) {
      port.postMessage({ type: "PLAYER_FOUND", url: sender.tab.url });
    }
  }

  sendResponse({ ok: true });
  return false;
});

// ── Panel sends commands back to the page (e.g. seek, pause) ─────────────────
// (Panel connects via port, sends { type: "COMMAND", ... })
// We forward those to the content script via chrome.tabs.sendMessage
chrome.runtime.onMessage.addListener((message, sender) => {
  if (message.type === "DEVTOOLS_COMMAND" && message.tabId) {
    chrome.tabs.sendMessage(message.tabId, {
      type: "BITMOVIN_COMMAND",
      command: message.command,
      args: message.args,
    });
  }
});

function bufferEvent(tabId, event) {
  if (!eventBuffers.has(tabId)) eventBuffers.set(tabId, []);
  const buf = eventBuffers.get(tabId);
  buf.push(event);
  if (buf.length > MAX_BUFFER) buf.shift();
}
