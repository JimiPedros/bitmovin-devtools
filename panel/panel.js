/**
 * panel.js — Runs inside the DevTools panel iframe.
 *
 * Connects to the background service worker via chrome.runtime.connect,
 * receives BITMOVIN_EVENT messages, and renders the UI.
 */

"use strict";

// ── State ────────────────────────────────────────────────────────────────────

const state = {
  events: [],
  seq: 0,
  paused: false,
  selectedId: null,
  activeTab: "payload",
  errorCount: 0,
  sessionStart: Date.now(),
  playerIds: new Set(),
  autoScroll: true,
};

// Category → dot color
const CAT_COLOR = {
  playback: "#4ec9b0",
  buffer:   "#569cd6",
  quality:  "#c586c0",
  ad:       "#dcdcaa",
  error:    "#f44747",
  drm:      "#e06c75",
  ui:       "#888888",
  metadata: "#abb2bf",
};

function categorise(name) {
  if (/^ad/.test(name))               return "ad";
  if (/error|warning/.test(name))     return "error";
  if (/drm/.test(name))               return "drm";
  if (/quality|adaptation/.test(name))return "quality";
  if (/download|segment|buffer|stall/.test(name)) return "buffer";
  if (/subtitle|fullscreen|cast|volume|audio|vr|viewmode/.test(name)) return "ui";
  if (/metadata|cue/.test(name))      return "metadata";
  return "playback";
}

// ── Background port ──────────────────────────────────────────────────────────

const tabId = chrome.devtools.inspectedWindow.tabId;
const port = chrome.runtime.connect({ name: `bitmovin-devtools-${tabId}` });

port.onMessage.addListener((message) => {
  if (message.type === "BULK_EVENTS") {
    message.events.forEach(processMessage);
    return;
  }
  processMessage(message);
});

port.onDisconnect.addListener(() => {
  console.warn("[Bitmovin DevTools] Port disconnected.");
});

function processMessage(message) {
  if (message.type === "PLAYER_FOUND") {
    document.getElementById("no-player-banner").classList.add("hidden");
    return;
  }
  if (message.type === "BITMOVIN_EVENT") {
    if (state.paused) return;
    ingestEvent(message.event);
  }
}

function ingestEvent(ev) {
  const cat = categorise(ev.name);
  const record = {
    id: ++state.seq,
    name: ev.name,
    cat,
    color: CAT_COLOR[cat] || "#888",
    ts: ev.ts,
    tsMs: ev.tsMs,
    playerId: ev.playerId || "player_1",
    data: ev.data,
    playerState: ev.playerState || {},
  };

  state.events.push(record);
  if (record.cat === "error") {
    state.errorCount++;
    updateErrBadge();
  }
  if (state.events.length > 1000) state.events.shift();

  state.playerIds.add(record.playerId);
  updateFooter(record.playerState);
  renderList();
  if (state.autoScroll && state.selectedId === null) {
    scrollListToBottom();
  }
}

// ── Render: Event List ───────────────────────────────────────────────────────

function renderList() {
  const filterText = document.getElementById("filter-text").value.toLowerCase();
  const filterCat  = document.getElementById("filter-cat").value;

  const filtered = state.events.filter((e) =>
    (!filterText || e.name.includes(filterText)) &&
    (!filterCat  || e.cat === filterCat)
  );

  const el = document.getElementById("event-list");
  el.innerHTML = filtered.map((e) => `
    <div class="event-item${state.selectedId === e.id ? " selected" : ""}"
         data-id="${e.id}">
      <span class="event-dot" style="background:${e.color}"></span>
      <span class="event-name">${escHtml(e.name)}</span>
      <span class="event-player-id">${escHtml(e.playerId)}</span>
      <span class="event-ts">${e.ts ? e.ts.substr(11, 8) : ""}</span>
      <span class="event-seq">#${e.id}</span>
    </div>
  `).join("");

  // Attach click handlers
  el.querySelectorAll(".event-item").forEach((row) => {
    row.addEventListener("click", () => {
      state.selectedId = parseInt(row.dataset.id, 10);
      state.autoScroll = false;
      renderList();
      renderDetail();
    });
  });

  document.getElementById("footer-count").textContent =
    `${state.events.length} events`;
}

function scrollListToBottom() {
  const pane = document.getElementById("event-list-pane");
  pane.scrollTop = pane.scrollHeight;
}

// ── Render: Detail Pane ──────────────────────────────────────────────────────

function renderDetail() {
  const ev = state.events.find((e) => e.id === state.selectedId);
  const body = document.getElementById("detail-body");

  if (!ev) {
    body.innerHTML = '<div class="empty-state">← Select an event to inspect</div>';
    return;
  }

  switch (state.activeTab) {
    case "payload":  renderPayload(ev, body); break;
    case "state":    renderState(ev, body);   break;
    case "timeline": renderTimeline(ev, body);break;
    case "diff":     renderDiff(ev, body);    break;
  }
}

function renderPayload(ev, body) {
  const obj = {
    event:    ev.name,
    category: ev.cat,
    sequence: ev.id,
    playerId: ev.playerId,
    timestamp: ev.ts,
    data: ev.data,
  };
  body.innerHTML = `<div class="json-tree">${jsonToHtml(obj)}</div>`;
}

function renderState(ev, body) {
  const s = ev.playerState;
  const fmt = (v) => (v === undefined || v === null) ? "—" : String(v);
  const cards = [
    ["position",      fmt(s.currentTime !== undefined ? s.currentTime?.toFixed?.(3) + "s" : "—")],
    ["duration",      fmt(s.duration !== undefined ? s.duration?.toFixed?.(1) + "s" : "—")],
    ["buffer ahead",  fmt(s.bufferLength !== undefined ? s.bufferLength?.toFixed?.(1) + "s" : "—")],
    ["bitrate",       s.videoQuality?.bitrate ? Math.round(s.videoQuality.bitrate / 1000) + " kbps" : "—"],
    ["is playing",    fmt(s.isPlaying)],
    ["is stalling",   fmt(s.isStalling)],
    ["is muted",      fmt(s.isMuted)],
    ["volume",        s.volume !== undefined ? (s.volume > 1 ? Math.round(s.volume) : Math.round(s.volume * 100)) + "%" : "—"],
    ["speed",         fmt(s.playbackSpeed)],
    ["stream type",   fmt(s.streamType)],
    ["view mode",     fmt(s.viewMode)],
    ["player",        fmt(ev.playerId)],
  ];

  body.innerHTML = `<div class="state-grid">` +
    cards.map(([label, val]) =>
      `<div class="state-card">
        <div class="state-label">${escHtml(label)}</div>
        <div class="state-val">${escHtml(val)}</div>
      </div>`
    ).join("") +
    `</div>`;
}

function renderTimeline(ev, body) {
  const idx = state.events.findIndex((e) => e.id === ev.id);
  const slice = state.events.slice(Math.max(0, idx - 15), idx + 3);
  const t0 = slice[0]?.tsMs || ev.tsMs;
  const tMax = (slice[slice.length - 1]?.tsMs || ev.tsMs) - t0 || 1;

  body.innerHTML = slice.map((e) => {
    const rel   = e.tsMs - t0;
    const pct   = Math.max(3, Math.round((rel / tMax) * 100));
    const isCur = e.id === ev.id;
    return `<div class="tl-row${isCur ? " tl-current" : ""}">
      <span class="tl-dot" style="background:${e.color}"></span>
      <span class="tl-name">${escHtml(e.name)}</span>
      <div class="tl-bar-wrap">
        <div class="tl-bar" style="width:${pct}%;background:${e.color}"></div>
      </div>
      <span class="tl-t">+${rel}ms</span>
    </div>`;
  }).join("");
}

function renderDiff(ev, body) {
  const idx  = state.events.findIndex((e) => e.id === ev.id);
  const prev = idx > 0 ? state.events[idx - 1] : null;

  if (!prev) {
    body.innerHTML = '<div class="empty-state">No previous event to diff against</div>';
    return;
  }

  const prevState = prev.playerState || {};
  const currState = ev.playerState   || {};
  const allKeys   = new Set([...Object.keys(prevState), ...Object.keys(currState)]);

  let html = `<div class="diff-label">Player state diff: #${prev.id} ${escHtml(prev.name)} → #${ev.id} ${escHtml(ev.name)}</div>`;
  html += `<div class="json-tree">`;

  for (const key of allKeys) {
    const a = JSON.stringify(prevState[key]);
    const b = JSON.stringify(currState[key]);
    if (a === b) continue;
    html += `<span class="diff-key">"${escHtml(key)}"</span>: `;
    html += `<span class="diff-removed">${escHtml(a ?? "undefined")}</span>`;
    html += ` → `;
    html += `<span class="diff-added">${escHtml(b ?? "undefined")}</span>\n`;
  }

  html += `</div>`;
  body.innerHTML = html;
}

// ── JSON renderer ────────────────────────────────────────────────────────────

function jsonToHtml(val, indent = 0) {
  const pad = "  ".repeat(indent);
  if (val === null)             return `<span class="json-null">null</span>`;
  if (val === undefined)        return `<span class="json-null">undefined</span>`;
  if (typeof val === "boolean") return `<span class="json-bool">${val}</span>`;
  if (typeof val === "number")  return `<span class="json-num">${val}</span>`;
  if (typeof val === "string")  return `<span class="json-str">"${escHtml(val)}"</span>`;
  if (Array.isArray(val)) {
    if (!val.length) return "[]";
    return "[\n" +
      val.map((v) => pad + "  " + jsonToHtml(v, indent + 1)).join(",\n") +
      "\n" + pad + "]";
  }
  if (typeof val === "object") {
    const entries = Object.entries(val);
    if (!entries.length) return "{}";
    return "{\n" +
      entries.map(([k, v]) =>
        pad + `  <span class="json-key">"${escHtml(k)}"</span>: ` + jsonToHtml(v, indent + 1)
      ).join(",\n") +
      "\n" + pad + "}";
  }
  return escHtml(String(val));
}

function escHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── Footer / badges ──────────────────────────────────────────────────────────

function updateErrBadge() {
  const b = document.getElementById("err-badge");
  if (state.errorCount > 0) {
    b.classList.remove("hidden");
    b.textContent = `${state.errorCount} error${state.errorCount > 1 ? "s" : ""}`;
  } else {
    b.classList.add("hidden");
  }
}

function updateFooter(ps) {
  if (!ps) return;
  const elapsed = Math.round((Date.now() - state.sessionStart) / 1000);
  document.getElementById("footer-session").textContent = `${elapsed}s`;
  if (ps.currentTime !== undefined)
    document.getElementById("footer-pos").textContent =
      `pos ${ps.currentTime?.toFixed?.(1) ?? "—"}s`;
  if (ps.bufferLength !== undefined)
    document.getElementById("footer-buf").textContent =
      `buf +${ps.bufferLength?.toFixed?.(1) ?? "—"}s`;
  if (state.playerIds.size)
    document.getElementById("footer-player").textContent =
      `${state.playerIds.size} player${state.playerIds.size > 1 ? "s" : ""}`;
}

// ── Controls ─────────────────────────────────────────────────────────────────

document.getElementById("btn-pause").addEventListener("click", () => {
  state.paused = !state.paused;
  const btn   = document.getElementById("btn-pause");
  const pulse = document.getElementById("pulse");
  const badge = document.getElementById("rec-badge");
  btn.textContent = state.paused ? "Resume" : "Pause";
  if (state.paused) {
    pulse.classList.remove("recording");
    badge.textContent = "● PAUSED";
    badge.style.background = "#3a3000";
    badge.style.color = "#e5b800";
  } else {
    pulse.classList.add("recording");
    badge.textContent = "● REC";
    badge.style.background = "";
    badge.style.color = "";
  }
});

document.getElementById("btn-clear").addEventListener("click", () => {
  state.events     = [];
  state.seq        = 0;
  state.errorCount = 0;
  state.selectedId = null;
  state.autoScroll = true;
  updateErrBadge();
  renderList();
  renderDetail();
});

document.getElementById("btn-export").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(state.events, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a   = document.createElement("a");
  a.href     = url;
  a.download = `bitmovin-events-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

document.getElementById("filter-text").addEventListener("input", renderList);
document.getElementById("filter-cat").addEventListener("change", renderList);

// Tab switching
document.getElementById("detail-tabs").addEventListener("click", (e) => {
  const tab = e.target.closest(".tab");
  if (!tab) return;
  document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
  tab.classList.add("active");
  state.activeTab = tab.dataset.tab;
  renderDetail();
});

// Auto-scroll: resume when user scrolls to bottom
document.getElementById("event-list-pane").addEventListener("scroll", (e) => {
  const el = e.target;
  state.autoScroll = el.scrollTop + el.clientHeight >= el.scrollHeight - 10;
});

// ── Init ─────────────────────────────────────────────────────────────────────

document.getElementById("pulse").classList.add("recording");
renderList();
