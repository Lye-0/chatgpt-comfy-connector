// Phase 1 placeholder. This script deliberately does not inspect or mutate
// the ChatGPT DOM and never opens a localhost connection. Future ChatGPT page
// features will request bridge operations through the background service worker.
(() => {
  const statusEventName = "chatgpt-comfy-connector:bridge-status";

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== "BRIDGE_STATE_CHANGED") return;
    window.dispatchEvent(new CustomEvent(statusEventName, { detail: message.state }));
  });

  chrome.runtime.sendMessage({ type: "CONTENT_SCRIPT_READY" }).catch(() => {});
})();
