# ChatGPT Comfy Connector Browser Extension

This is the Chromium Manifest V3 Extension for v0.2 Phase 1–2. Load this folder
as an unpacked extension in Chrome or Edge. On first use, enter the one-time
Pairing code shown by the Desktop and choose `PAIR DESKTOP`; later starts use
the saved pairing credential to bootstrap a fresh Desktop session token. The
Background service worker owns all local Bridge access. When the Desktop sends
a Handoff, it only relays the request to the active `https://chatgpt.com/*`
tab. If that tab was already open when the unpacked Extension was reloaded,
the Background can inject the Content Script through the narrowly scoped
ChatGPT host permission. The Content Script owns the replaceable ChatGPT
composer/send locators and returns a send result only after a new matching
user message containing the current Handoff identifiers is visible; it does
not read the ChatGPT response. Textarea and contenteditable composers use
separate editor-aware input paths, and a composer-only clear is never treated
as a successful send.

See [`docs/browser-extension-bridge.md`](../docs/browser-extension-bridge.md)
for the protocol, security boundary, and loading steps.
