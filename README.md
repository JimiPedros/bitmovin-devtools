# Bitmovin Player DevTools

A Chrome extension that adds a **Bitmovin** tab to Chrome DevTools, giving you Redux DevTools-style inspection of every Bitmovin Player event on the page.

---

## Features

- **Live event stream** — all `player.on(...)` events captured in real-time
- **Event payload** — syntax-highlighted JSON for each event's data
- **Player state snapshot** — position, buffer, bitrate, isPlaying, isStalling etc. at the moment each event fired
- **Timeline view** — relative timing of surrounding events
- **Diff view** — what changed in player state between consecutive events
- **Filter** — by event name substring or category
- **Pause / Resume** — freeze the stream without losing events
- **Export JSON** — download the full event log
- **Multi-player** — tracks multiple player instances on the same page

---

## Installation (unpacked extension)

1. Open Chrome and navigate to `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select this folder (`bitmovin-devtools/`)
5. Open a page that uses the Bitmovin Player
6. Open Chrome DevTools (`F12` / `Cmd+Opt+I`)
7. Click the **Bitmovin** tab

> The extension works with Bitmovin Player **v8 and v9** (Web SDK).  
> It must load *before* the player is instantiated to patch the constructor.  
> If the player is already on the page when the tab is opened, existing instances are detected via `window.bitmovin.player.instances`.

---

## Project Structure

```
bitmovin-devtools/
├── manifest.json              # MV3 extension manifest
│
├── background/
│   └── service_worker.js      # Message relay (content ↔ panel)
│
├── content/
│   ├── injector.js            # Content script (isolated world bridge)
│   └── hook.js                # Page-context script (patches window.bitmovin)
│
├── devtools/
│   ├── devtools.html          # DevTools entry point (loaded by Chrome)
│   └── devtools.js            # Registers the "Bitmovin" panel
│
├── panel/
│   ├── panel.html             # Panel UI
│   ├── panel.css              # Panel styles (dark + light mode)
│   └── panel.js               # Panel logic (event list, detail views)
│
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

---

## Architecture & Message Flow

```
┌──────────────────────────────────┐
│           PAGE CONTEXT           │
│                                  │
│  window.bitmovin.player.Player   │
│         (patched ctor)           │
│              │                   │
│     player.on() → emit()         │
│              │                   │
│   window.postMessage(event)      │
└──────────────┬───────────────────┘
               │  postMessage
┌──────────────▼───────────────────┐
│       CONTENT SCRIPT             │
│       (injector.js)              │
│                                  │
│  chrome.runtime.sendMessage()    │
└──────────────┬───────────────────┘
               │  sendMessage
┌──────────────▼───────────────────┐
│     BACKGROUND SERVICE WORKER    │
│     (service_worker.js)          │
│                                  │
│  Buffers events per tab          │
│  port.postMessage → panel        │
└──────────────┬───────────────────┘
               │  port (connect)
┌──────────────▼───────────────────┐
│        DEVTOOLS PANEL            │
│        (panel.js)                │
│                                  │
│  Renders event list + detail     │
└──────────────────────────────────┘
```

---

## Extending

### Add a new detail tab
1. Add a `<button class="tab" data-tab="myview">My View</button>` in `panel.html`
2. Add a `case "myview": renderMyView(ev, body); break;` in `panel.js`
3. Implement `renderMyView(ev, body)`

### Add player commands from the panel
The panel can call back into the page via the `DEVTOOLS_COMMAND` message type:

```js
// In panel.js
chrome.runtime.sendMessage({
  type: "DEVTOOLS_COMMAND",
  tabId: chrome.devtools.inspectedWindow.tabId,
  command: "seek",
  args: [30],
});
```

Commands available in `hook.js`: `seek(time)`, `pause()`, `play()`.  
Add more by extending `player.__devtools` in `hook.js`.

### Support additional player versions
Edit the polling / patching logic in `hook.js`. The constructor patch handles
v8/v9. For older versions that don't expose `window.bitmovin.player.Player`,
you can patch `player.on` directly after detecting a player instance via
a MutationObserver on the container element.

