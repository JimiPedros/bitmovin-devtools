/**
 * bitmovin-devtools-bridge.js
 *
 * Drop this file into your project and call registerWithDevtools() after
 * creating your Bitmovin player instance. Works in React, Angular, Vue,
 * or any bundled app where the player is not available on window.bitmovin.
 *
 * The bridge is safe to ship in production — if the DevTools extension is
 * not installed, every function here exits immediately with no side effects.
 *
 * Usage:
 *
 *   import { registerWithDevtools } from './bitmovin-devtools-bridge';
 *
 *   const player = new Player(container, config);
 *   registerWithDevtools(player, { id: 'main-player' });
 *
 * This project is not affiliated with Bitmovin GmbH.
 * See https://github.com/yourname/bitmovin-devtools for full details.
 */

/**
 * Register a Bitmovin player instance with the DevTools extension.
 *
 * @param {object} player  - The Bitmovin player instance returned by new Player()
 * @param {object} options
 * @param {string} [options.id] - Optional label shown in the panel (e.g. 'main-player').
 *                                Useful when you have more than one player on the page.
 */
export function registerWithDevtools(player, options = {}) {
  if (typeof window === 'undefined') return; // SSR guard
  if (!window.__BITMOVIN_DEVTOOLS_HOOK__) return; // extension not installed

  if (!player) {
    console.warn('[bitmovin-devtools-bridge] registerWithDevtools() called with no player instance.');
    return;
  }

  window.__BITMOVIN_DEVTOOLS_HOOK__.registerPlayer(player, options);
}

/**
 * Emit a custom event into the DevTools panel.
 *
 * Use this to log app-level state changes alongside player events —
 * for example, when content metadata loads, a user action fires,
 * or your app changes playback source.
 *
 * @param {string} eventName - Name shown in the event list
 * @param {object} [data]    - Any serialisable data to show in the payload tab
 *
 * @example
 *   emitCustomEvent('content_metadata_loaded', { title: 'Sintel', duration: 888 });
 *   emitCustomEvent('user_changed_quality', { selectedBitrate: 2400000 });
 */
export function emitCustomEvent(eventName, data = {}) {
  if (typeof window === 'undefined') return;
  if (!window.__BITMOVIN_DEVTOOLS_HOOK__) return;

  if (!eventName || typeof eventName !== 'string') {
    console.warn('[bitmovin-devtools-bridge] emitCustomEvent() requires a non-empty string as the first argument.');
    return;
  }

  window.__BITMOVIN_DEVTOOLS_HOOK__.emit(eventName, data);
}

/**
 * Check whether the DevTools extension is installed and active on this page.
 * Useful if you want to conditionally enable more verbose logging.
 *
 * @returns {boolean}
 *
 * @example
 *   if (isDevtoolsInstalled()) {
 *     emitCustomEvent('app_boot', { config, env: process.env.NODE_ENV });
 *   }
 */
export function isDevtoolsInstalled() {
  return typeof window !== 'undefined' && !!window.__BITMOVIN_DEVTOOLS_HOOK__;
}

