/**
 * hook.js — Runs in PAGE context (not extension context).
 *
 * Injected by injector.js via a <script> tag so it has full access to
 * window.bitmovin and any player instances on the page.
 *
 * Detection strategies (in order):
 *  1. window.__BITMOVIN_DEVTOOLS_HOOK__.registerPlayer() — explicit bridge call from app code
 *  2. window.bitmovin.player.Player constructor patch — public SDK on window
 *  3. window.bitmovin.player.instances scan — already-created public instances
 */

(function () {
  "use strict";

  if (window.__bitmovinDevtoolsHooked) return;
  window.__bitmovinDevtoolsHooked = true;

  const SOURCE = "__bitmovin_hook__";

  // ── Messaging ──────────────────────────────────────────────────────────────

  function emit(eventName, data, playerId) {
    window.postMessage({
      type: "BITMOVIN_EVENT",
      source: SOURCE,
      event: {
        name: eventName,
        data: safeClone(data),
        playerId,
        playerState: getPlayerState(playerId),
        tsMs: Date.now(),
        ts: new Date().toISOString(),
      },
    }, "*");
  }

  function emitPlayerFound(playerId, source) {
    window.postMessage({
      type: "BITMOVIN_PLAYER_FOUND",
      source: SOURCE,
      playerId,
      detectedVia: source, // 'bridge' | 'constructor' | 'scan'
    }, "*");
  }

  // ── Serialisation ──────────────────────────────────────────────────────────

  function safeClone(obj, depth = 0) {
    if (depth > 6) return "[nested]";
    if (obj === null || obj === undefined) return obj;
    const t = typeof obj;
    if (t === "number" || t === "boolean" || t === "string") return obj;
    if (t === "function") return "[Function]";
    if (obj instanceof Error) return { message: obj.message, code: obj.code };
    if (obj instanceof Element) return "[HTMLElement]";
    if (Array.isArray(obj)) return obj.map((v) => safeClone(v, depth + 1));
    if (t === "object") {
      const out = {};
      for (const k of Object.keys(obj)) {
        try { out[k] = safeClone(obj[k], depth + 1); } catch (_) { out[k] = "[error]"; }
      }
      return out;
    }
    return String(obj);
  }

  // ── Player state snapshot ──────────────────────────────────────────────────

  const playerInstances = new Map();

  function getPlayerState(playerId) {
    const p = playerInstances.get(playerId);
    if (!p) return {};
    try {
      const rawVolume = safeProp(p, "getVolume");
      return {
        currentTime:   safeProp(p, "getCurrentTime"),
        duration:      safeProp(p, "getDuration"),
        isPlaying:     safeProp(p, "isPlaying"),
        isPaused:      safeProp(p, "isPaused"),
        isStalling:    safeProp(p, "isStalling"),
        isMuted:       safeProp(p, "isMuted"),
        // Normalise to 0–1 regardless of whether SDK returns 0–1 or 0–100
        volume:        rawVolume !== undefined ? (rawVolume > 1 ? rawVolume / 100 : rawVolume) : undefined,
        playbackSpeed: safeProp(p, "getPlaybackSpeed"),
        videoQuality:  safeProp(p, "getVideoQuality"),
        audioQuality:  safeProp(p, "getAudioQuality"),
        bufferLength:  safeBufferLength(p),
        viewMode:      safeProp(p, "getViewMode"),
        streamType:    safeProp(p, "getStreamType"),
      };
    } catch (_) {
      return {};
    }
  }

  function safeProp(player, method) {
    try { return player[method](); } catch (_) { return undefined; }
  }

  function safeBufferLength(player) {
    try {
      const info = player.buffer.getLevel("forwardduration", "video");
      return info ? info.level : undefined;
    } catch (_) { return undefined; }
  }

  // ── Patch a player instance ────────────────────────────────────────────────

  let playerCounter = 0;

  function patchPlayer(player, idOverride, detectedVia = 'constructor') {
    // Don't patch the same instance twice
    if (player.__bitmovinDevtoolsId) return;

    const playerId = idOverride || ("player_" + ++playerCounter);
    playerInstances.set(playerId, player);
    player.__bitmovinDevtoolsId = playerId;

    emitPlayerFound(playerId, detectedVia);

    // Register one shadow listener per event name, not one per .on() call
    const hookedEvents = new Set();
    const originalOn = player.on.bind(player);

    player.on = function (eventName, handler, ...rest) {
      if (!hookedEvents.has(eventName)) {
        hookedEvents.add(eventName);
        originalOn(eventName, (data) => {
          emit(eventName, data, playerId);
        });
      }
      return originalOn(eventName, handler, ...rest);
    };

    // Convenience methods for panel commands
    player.__devtools = {
      seek:  (t) => player.seek(t),
      pause: ()  => player.pause(),
      play:  ()  => player.play(),
    };

    console.debug("[Bitmovin DevTools] Hooked player:", playerId, "via", detectedVia);
  }

  // ── Global hook — explicit bridge registration ─────────────────────────────
  //
  // Defined BEFORE any app code runs so apps can call it immediately.
  // Usage in app code (after importing bitmovin-devtools-bridge):
  //
  //   window.__BITMOVIN_DEVTOOLS_HOOK__.registerPlayer(player, { id: 'main' });
  //
  // The hook is intentionally inert if the extension is not installed —
  // apps can safely ship calls to this in production.

  window.__BITMOVIN_DEVTOOLS_HOOK__ = {
    _players: new Map(),

    registerPlayer(player, options = {}) {
      if (!player) {
        console.warn("[Bitmovin DevTools] registerPlayer() called with no player instance.");
        return;
      }
      const id = options.id || ("player_" + (this._players.size + 1));
      this._players.set(id, player);
      patchPlayer(player, id, 'bridge');
    },

    // Allows apps to emit arbitrary custom events into the devtools panel
    emit(eventName, data) {
      emit(eventName, data, 'custom');
    },
  };

  // ── Auto-detect: constructor patch ────────────────────────────────────────

  function hookBitmovin(bitmovin) {
    const OriginalPlayer = bitmovin.player.Player;
    if (!OriginalPlayer || OriginalPlayer.__devtoolsPatched) return;

    bitmovin.player.Player = function (...args) {
      const instance = new OriginalPlayer(...args);
      patchPlayer(instance, null, 'constructor');
      return instance;
    };

    Object.setPrototypeOf(bitmovin.player.Player, OriginalPlayer);
    Object.assign(bitmovin.player.Player, OriginalPlayer);
    bitmovin.player.Player.prototype = OriginalPlayer.prototype;
    bitmovin.player.Player.__devtoolsPatched = true;

    console.debug("[Bitmovin DevTools] Player constructor patched.");
  }

  // ── Auto-detect: existing instances (created before hook ran) ─────────────

  function scanForExistingPlayers() {
    try {
      if (window.bitmovin?.player?.instances) {
        for (const p of Object.values(window.bitmovin.player.instances)) {
          patchPlayer(p, null, 'scan');
        }
      }
    } catch (_) {}
  }

  // ── Poll for window.bitmovin ───────────────────────────────────────────────

  let attempts = 0;
  const MAX_ATTEMPTS = 60; // 30s

  function poll() {
    attempts++;
    if (window.bitmovin?.player?.Player) {
      hookBitmovin(window.bitmovin);
      scanForExistingPlayers();
      return;
    }
    if (attempts < MAX_ATTEMPTS) {
      setTimeout(poll, 500);
    }
  }

  poll();

  // ── Commands from panel ────────────────────────────────────────────────────

  window.addEventListener("message", (e) => {
    if (e.source !== window) return;
    if (e.data?.type !== "BITMOVIN_COMMAND") return;
    const { playerId, command, args } = e.data;
    const player = playerInstances.get(playerId);
    if (!player?.__devtools) return;
    try {
      player.__devtools[command]?.(...(args || []));
    } catch (err) {
      console.warn("[Bitmovin DevTools] Command failed:", err);
    }
  });

})();