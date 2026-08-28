# ChatGPT Comfy Connector Browser Extension

This is the Chromium Manifest V3 Extension for v0.2 Phase 1. Load this folder
as an unpacked extension in Chrome or Edge. On first use, enter the one-time
Pairing code shown by the Desktop and choose `PAIR DESKTOP`; later starts use
the saved pairing credential to bootstrap a fresh Desktop session token. The
Extension only verifies the local Desktop Bridge in this phase; it does not
inspect or operate the ChatGPT DOM.

See [`docs/browser-extension-bridge.md`](../docs/browser-extension-bridge.md)
for the protocol, security boundary, and loading steps.
