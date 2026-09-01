# ChatGPT Comfy Connector Browser Extension

This is the Chromium Manifest V3 Extension for v0.2 Phase 1–5.2. Load this folder
as an unpacked extension in Chrome or Edge. On first use, enter the one-time
Pairing code shown by the Desktop and choose `PAIR DESKTOP`; later starts use
the saved pairing credential to bootstrap a fresh Desktop session token. The
Background service worker owns all local Bridge access and one connector-owned
Managed Execution Window containing one active Managed ChatGPT Tab. The window
is created non-focused and non-minimized; the tab is active within that window
with automatic discarding disabled. A Handoff is sent only after that tab has
passed the Content Script, Conversation, Composer, and response-watcher
readiness handshakes; the user's foreground tab is never selected as an
execution target. Conversation ID/URL is the durable target identity and the
window/tab are only replaceable browser media. The Content Script owns the
replaceable ChatGPT composer/send locators and returns a send result only after a new matching user
message containing the current Handoff identifiers is visible; it does not
read the ChatGPT response during Handoff sending. After Desktop confirms a
ComfyUI Primary Output, the Background fetches the registered bytes through the
authenticated Bridge and relays bounded chunks to the same Managed Tab; the
Content Script attaches the resulting `File` through ChatGPT's file input and
verifies the attachment. The Extension receives no local path. Textarea and
contenteditable composers use separate editor-aware input paths, and a
composer-only clear is never treated as a successful send.

See [`docs/browser-extension-bridge.md`](../docs/browser-extension-bridge.md)
for the protocol, security boundary, and loading steps.

## Managed Execution Window and ChatGPT Tab

Execution is isolated from the user's foreground browser tab. The Background
service worker owns one non-focused, non-minimized Execution Window and one
active Managed ChatGPT Tab inside it. It prepares the Content Script, target
Conversation, composer, and shared assistant-response watcher before sending a
Handoff. Conversation ID/URL is the durable execution identity; the
window/tab are only replaceable browser media. If the managed tab or Execution
Window is closed or navigated during a pending operation, the Background
recreates or rebinds the active tab in the connector-owned window to the same
Conversation identity and continues the correlated watcher without sending the
Handoff again. The user's foreground Window is never focused or retargeted.
When the Execution Window is first created, its width and height are each set
to about half of the last-focused browser window (roughly one quarter of its
area); an internal fallback size is used if those bounds are unavailable.

Project/Chat discovery uses a separate non-focused Collector Window with one
active Collector Tab. The tab is reused for the root sidebar and every Project
page. Root Project discovery reuses the previously successful metadata-only
route exactly once per refresh generation: the known ChatGPT history sidebar, its visible
`data-sidebar-item="true"` rows, Project-home anchors, and the same bounded
sidebar scroll. It may expand a dedicated `さらに表示`/`もっと見る` button, but
never clicks a generic row or navigates to infer an ID; `/schedule`,
`/plugins`, search, and ordinary Chat rows therefore cannot become Project
targets. The tab is never used for Handoff, media, Review, Resume, or
assistant-response observation. A route-less Project entry is incomplete
discovery and causes a bounded refresh to fail rather than triggering
navigation to guess its identity. The Collector Window is independent from the
Managed Execution Window and the user's foreground tabs. Its metadata-only
snapshot is persisted by Desktop so the previous list can be shown while a
new bounded refresh runs. It starts at about half the reference window width
and height (with an outer-width floor near 820px), then verifies the Content
Script viewport and desktop sidebar structure without scrolling or collecting
Project rows. The one-shot locator call then selects the visible sidebar shell
and one Project-owning element whose `scrollTop` actually moves, collects after
each lazy-load settle using monotonically increasing scroll positions, restores
the saved position once, and requires bottom/no-growth plus a discovered
Project section before completion. A bounded zero-Project result fails as
`context_projects_incomplete` instead of being published as an empty
successful snapshot. Window membership is reconciled before the single root
scan so the
initial `windows.create({ url })` Tab is reused and duplicate Collector Tabs
are removed.
