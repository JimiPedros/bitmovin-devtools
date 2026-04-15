// Runs in the DevTools context.
// Creates a panel tab called "Bitmovin" next to Elements, Console, etc.

chrome.devtools.panels.create(
  "Bitmovin",
  "/icons/icon16.png",
  "/panel/panel.html",
  (panel) => {
    // panel.onShown / panel.onHidden hooks available if needed
    console.log("[Bitmovin DevTools] Panel registered");
  }
);
