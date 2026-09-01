# Browser Extension Bridge (v0.2 Phase 1–5.2)

## Scope

Phase 1 connects the Chromium Browser Extension to the running Desktop
Connector. Phase 2 adds one narrow action: Desktop can deliver the already
generated Bootstrap Handoff to one connector-owned Managed `chatgpt.com` tab,
where the Content Script fills the composer and submits it. Phase 3.1–3.3 observes
the completed assistant response, validates it on Desktop as a Connector
Response, and places it into `CHATGPT COMMAND`. Phase 4 connects a strictly
validated `generate` Response to the existing Desktop APPLY → ComfyUI READY
→ GENERATE → OUTPUT path, while retaining the manual controls as a safe
fallback. A strictly validated `complete` Response completes the session only
when the existing output/review rules allow it. Project/conversation metadata
discovery is available through the authenticated Extension bridge; message-body
history sync and autonomous infinite iteration remain out of scope. Phase 5.1 adds one
more bounded action: after a successful ComfyUI generation, the Desktop can
register the current Primary Output and have the Extension attach it to the
same ChatGPT Conversation through the Managed Tab. Phase 5.2 then sends a fresh Review Handoff after the
attachment is verified and can continue the existing APPLY → GENERATE path
for the next iteration; complete, maximum-iteration, cancellation, and retry
boundaries remain explicit Desktop state-machine decisions.

```text
ChatGPT page content script (DOM only: input/send/response observation)
          ⇅ chrome.runtime
MV3 background service worker
          ⇅ HTTP health / pairing / bootstrap / authenticated WebSocket
http://127.0.0.1:43127
          ⇅
Desktop Connector Bridge
```

The Content Script owns ChatGPT DOM access only. All localhost access is owned
by `browser-extension/background.js`; the Content Script never opens a local
HTTP or WebSocket connection.

## Managed Execution Window lifecycle

The Background service worker owns exactly one connector-created Execution
Window and exactly one active Managed ChatGPT Tab inside it for execution. The
Execution Window is created with `focused: false` and `state: "normal"`; the
Managed Tab is kept `active: true` within that window and
`autoDiscardable: false`. On creation its width and height are each about half
of the last-focused browser window (roughly one quarter of its area), with a
safe fixed fallback when the size cannot be read. Reused windows keep their
existing size. The user's Chrome Window and its foreground tab are never
selected as execution targets or focused by the connector.

The Background creates or reuses the Execution Window and navigates its Managed
Tab only from the bound Conversation ID/URL (or a project-matched new-chat
target). The user's foreground tab and its active/focus state do not affect
Handoff, media, Review, or response delivery.

Project/Chat discovery is isolated in a separate non-focused Collector Window
with one active Collector Tab. The Background creates or reuses that Window on
demand, keeps its only Collector Tab active and non-discardable, scans the root
sidebar, and reuses the same tab for every Project page. The Collector Window
is never used for Handoff, media, Review, Resume, or assistant-response
observation, and it does not replace the Managed Execution Tab's watcher state.
The Collector Window starts at roughly half the reference window width and
height, with an outer-width floor of about 820px. Before discovery, the
Content Script reports `window.innerWidth` and non-mutating sidebar structure
readiness; the Background widens the non-focused Window and rechecks until the
desktop sidebar viewport is available. Readiness never scrolls or collects
Project rows. The root Project discovery call is a one-shot operation for its
refresh generation: it selects one Sidebar and one scroll container, scans only
downward through the virtualized Project section, restores the saved position
once, and then freezes the resulting Project metadata while the Collector Tab
visits Project URLs for Chat discovery. A bounded zero-Project result is
reported as `context_projects_incomplete`, never as a successful empty
snapshot. Each lifecycle reconciliation verifies one Window member, the active
Collector Tab ID, and the non-discardable tab state; lifecycle events do not
restart a completed Project discovery.

The Execution Window and tab are replaceable browser media, not the Conversation
identity. Before
each Handoff, the Background requires these ordered handshakes from the
Content Script: Content Script ready, target Conversation ready, composer
ready, and shared assistant-response watcher ready. Only then does it send the
Handoff. A pre-send watcher first records the current assistant-message
baseline and waits for the new marker-bearing user message; it does not use an
older message as an anchor. Initial, media, Review, and resumed/next-iteration
operations all use this same Managed Tab and watcher infrastructure.

If navigation or tab replacement destroys the Content Script, the Background
retains only bounded correlation metadata and the durable Conversation
identity, re-injects or waits for the replacement Content Script, and re-arms
the same watcher. It may recover an accepted user message, but it never posts
the same Handoff again merely because an acknowledgement or message channel
was lost. A closed Managed Tab is recreated active in the existing Execution
Window at the same Conversation URL when the operation still has enough
identity to do so. If the Execution Window is closed, the Background recreates
the Window and its Managed Tab before rebinding the same Conversation.
Discarded/frozen execution media and a lost Content Script go through the same
bounded recovery/re-arm path. Recovery never posts an already accepted Handoff
again; the Conversation identity is durable and the tab/window IDs are
disposable.

### Managed Tab lifecycle telemetry

The Background emits metadata-only `managed tab lifecycle telemetry` entries
for Managed Tab creation, Handoff send boundaries, watcher arm/re-arm, response
completion/error, periodic response waiting, Content Script readiness, and the
`tabs.onActivated`, `tabs.onUpdated`, `tabs.onRemoved`, and
`windows.onFocusChanged` events. The snapshot includes `tab_id`, `window_id`,
`tab_active`, `tab_discarded`, `tab_frozen`, `tab_auto_discardable`,
`window_focused`, `tab_status`, `managed_tab_exists`, `content_script_alive`,
the bounded correlation IDs, and `watcher_state`. Execution Window entries also
include `execution_window_id`, `execution_window_focused`,
`execution_window_state`, `execution_window_exists`, and
`execution_window_minimized`. A
`managed tab lifecycle state changed` entry identifies changes to active,
focused, discarded, frozen, or existence state.

The Content Script emits `content script lifecycle`, `document visibility
changed`, and `response lifecycle telemetry` entries. These include
`document_visibility_state`, `document_hidden`, `document_was_discarded`,
`content_script_alive`, `watcher_state`, and `assistant_state` (`not_detected`,
`streaming`, `stable_wait`, or `completed`). Periodic watcher diagnostics are
throttled to one entry per ten seconds, in addition to state transitions.
Neither side logs Handoff/Response bodies, credentials, tokens, media content,
or local filesystem paths. Lifecycle telemetry is metadata-only; the execution
policy itself keeps the connector tab active, disables automatic discarding,
and recovers the connector-owned Window/Tab when its lifecycle is lost. It
never activates or focuses a user-owned Chrome Window.

## Desktop placement and lifecycle

- Core contract and shared message/state models:
  `src/ChatGPTComfyConnector.Core/Services/Contracts.cs` and
  `src/ChatGPTComfyConnector.Core/Models/BrowserExtensionBridgeModels.cs`
- Pairing persistence:
  `src/ChatGPTComfyConnector.Infrastructure/Storage/PortableStore.cs`
- Transport implementation:
  `src/ChatGPTComfyConnector.Infrastructure/Bridge/BrowserExtensionBridge.cs`
- Composition root:
  `src/ChatGPTComfyConnector.Desktop/App.xaml.cs`
- ViewModel state projection:
  `src/ChatGPTComfyConnector.Desktop/ViewModels/MainViewModel.cs`

The WPF app uses manual dependency composition. `App` creates one
`BrowserExtensionBridge` with the existing `PortableStore` pairing boundary
and injects it into `MainWindow` and `MainViewModel`. `InitializeAsync` starts
the listener, while the close path and `App.OnExit` stop it. The stop operation
is idempotent, so both lifecycle paths are safe. The Bridge port is a protocol
constant rather than a mutable ComfyUI setting and is not written to
`config/settings.json`.

The existing Connector, MCP, ComfyUI, and GPU indicators remain independent.
The Extension indicator is integrated into the same `SYSTEM CONNECTION`
header, alongside those four runtime facts. The pairing code is shown there
only while pairing is required and is hidden after pairing/connection; it is
never included in health responses or logs. The Timeline and `CHATGPT COMMAND`
area remain the natural detailed surfaces for Handoff/Response and manual
recovery actions.

## ChatGPT Project / Conversation metadata

The Desktop context selectors use the authenticated Extension as a
metadata-only provider. The Extension reads the visible ChatGPT sidebar and
the current SPA URL; it does not read conversation message bodies, call a
private ChatGPT API, or expose arbitrary browser automation. In the current
ChatGPT DOM, Project entries may be route-bearing links or `role="button"`
rows with a nested visible `data-marquee-text` title, while conversations may
be `a[href]` entries or ID-bearing metadata nodes. The locator layer therefore
never uses an accessible name as a Project/Conversation title. The request types are
`chatgpt.context.list.request` and
`chatgpt.context.current.request`; responses are
`chatgpt.context.list.response` and `chatgpt.context.current.response`.

The list response contains bounded entries of the following shape:

```json
{
  "type": "chatgpt.context.list.response",
  "request_id": "<request-id>",
  "status": "ok",
  "projects": [
    { "project_id": "g-p-example", "title": "制作", "url": "https://chatgpt.com/g/g-p-example/project" },
    { "project_id": "g-p-example-2", "title": "表示されたProject", "url": "https://chatgpt.com/g/g-p-example-2/project" }
  ],
  "conversations": [
    { "conversation_id": "<conversation-id>", "title": "新しい制作", "url": "https://chatgpt.com/g/g-p-example/c/<conversation-id>", "project_id": "g-p-example", "project_title": "制作" },
    { "conversation_id": "<conversation-id-2>", "title": "個人メモ", "url": "https://chatgpt.com/c/<conversation-id-2>" }
  ],
  "current": {
    "conversation_id": "<conversation-id>",
    "title": "新しい制作",
    "url": "https://chatgpt.com/g/g-p-example/c/<conversation-id>",
    "project_id": "g-p-example",
    "project_title": "制作"
  }
}
```

Projectless conversations have no `project_id` and are shown under
`Projectなし`. Project discovery reuses the previously successful
metadata-only Sidebar route: it reads the known ChatGPT history sidebar's
visible `data-sidebar-item="true"` rows and Project-home anchors. A dedicated
`さらに表示`/`もっと見る` utility button may be expanded, but generic sidebar
rows, navigation controls, search UI, and title-only rows are never clicked to
infer a Project ID. If a Project entry is not ID/URL-complete, the Collector returns
`context_projects_incomplete` rather than publishing an incomplete Project
catalog. The Desktop always provides
an explicit `＋ 新しいChat` choice for a resolvable Project; selecting it does
not fabricate a conversation ID. A catalog is
reported as `Loading`, `Loaded`, `Empty`, `Disconnected`, or `Error`, and the
context panel has an explicit refresh action. Push/pop-state and relevant
sidebar changes can emit a current-context event, but that event never
changes the active Desktop session or starts a Handoff by itself.

After the root scan, the Background emits metadata-only Project resolution
diagnostics. `collector_project_metadata_resolution` contains the discovered,
resolved, and unresolved counts, while `collector_project_metadata_item`
contains only each row's index, title/ID/URL presence, resolution status, and
an unresolved reason. When the refresh fails with
`context_projects_incomplete`, the corresponding `collector_project_metadata_resolution_failed`
and reason-count entries preserve the same aggregate without logging Project
titles, IDs, URLs, message bodies, credentials, tokens, media, or local paths.

List discovery first performs the single bounded root Project scan. It expands
only bounded, dedicated `さらに表示`/`もっと見る` controls, then scans the same
known Sidebar scroll container in small steps for visible Project and
Projectless Conversation metadata. A scroll is accepted only when the
element's `scrollTop` changes; rows are collected again after each bounded
lazy-load settle, and completion requires the bounded scan to finish and an
ID-complete merge. No Project row is opened during this
phase, so `/schedule`, `/plugins`, search controls, and other generic Sidebar
navigation cannot become discovery targets. The resolved Project entries are
merged by `project_id`, and conversations are merged by `conversation_id`. For
every resolved Project, the same Collector Tab navigates directly to its Project URL and
scans every independent Project chat scrollport with the same actual-container
selection, bounded scrolling, timeout, and cancellation. The active scrollport
is rebound by logical container position after SPA replacement rather than
silently switching to the first list. The original scroll positions are
restored in `finally` paths. The Collector result is therefore an ID-complete metadata
snapshot without selecting a Chat, changing the composer, or sending a
Handoff.

The Collector Window is independent from the Managed Execution Window. A
closed Collector Window or Tab is recreated/reused for the next refresh, while
the current refresh generation prevents an older result from replacing a newer
snapshot. Desktop persists only Project/Conversation metadata in its portable
cache; message bodies, prompts, attachments, credentials, and tokens are not
cached or logged. If a refresh reports an incomplete empty Project discovery,
the cached metadata remains visible but the catalog is marked `Error` until a
complete refresh succeeds.

When a session is bound to an existing Chat, Desktop persists its conversation
ID and canonical URL in the session binding. Handoff, media attachment, and
Review routing use that identity to find the exact open tab or reopen the
exact saved conversation URL. A new Chat is routed only to a project-matched
new-conversation page (or the ChatGPT root for `Projectなし`); an unrelated
conversation is never navigated or used as a target. After a successful
first Handoff, the current context returned by the Content Script can bind a
new conversation if ChatGPT has assigned its ID. If it has not yet assigned
one, Desktop keeps the operation safe and does not invent an identifier.

## Endpoints

The listener prefix is always `http://127.0.0.1:43127/`. It never binds to
`0.0.0.0`. Tests can pass port `0` to obtain an ephemeral loopback port; the
production composition uses the fixed protocol port.

### `GET /health`

Health is read-only metadata. It never contains either the pairing credential
or the process session token, regardless of Origin. This keeps the endpoint
safe for ordinary browser diagnostics.

```json
{
  "ok": true,
  "service": "chatgpt-comfy-connector",
  "bridge_version": "0.2-alpha",
  "protocol": "chatgpt-comfy-connector.bridge/1",
  "bind_address": "127.0.0.1",
  "port": 43127,
  "websocket_path": "/bridge",
  "bootstrap_path": "/api/v1/bootstrap",
  "extension_connected": true,
  "connection_state": "CONNECTED",
  "pairing_state": "PAIRED",
  "auth": {
    "scheme": "pairing-credential",
    "required": true,
    "scope": "bootstrap"
  }
}
```

### `POST /api/v1/pair`

Pairing is an explicit user-mediated bootstrap. The Desktop generates a
short-lived, one-time code and displays it in the `SYSTEM CONNECTION` header
only while pairing is required. The user enters that code in the Extension popup. The
request must include `X-Connector-Client: browser-extension`; an accepted
Chromium extension Origin is used when the browser supplies one. The
Service Worker path also works when Chromium omits Origin for an authorized
extension Fetch. A normal web-page Origin is rejected.

```json
{ "pairing_code": "ABCD-EFGH-IJKL" }
```

The response contains a new `pairing_id` and raw `pairing_credential` exactly
once. The Desktop persists only a SHA-256 verifier in
`config/browser-extension-pairing.json`; the Extension stores the raw
credential in `chrome.storage.local`.

### `POST /api/v1/bootstrap`

The Extension sends the saved pairing credential as
`Authorization: Bearer <pairing_credential>` together with the explicit
client header. The Desktop returns the current process-scoped session token
and its expiry:

```json
{
  "ok": true,
  "pairing_id": "<id>",
  "protocol": "chatgpt-comfy-connector.bridge/1",
  "session_token": "<short-lived process token>",
  "session_expires_at": "<ISO-8601>",
  "websocket_path": "/bridge"
}
```

The session token is held only in Service Worker memory and is not persisted
or logged. A Desktop restart creates a new process token; the saved pairing
credential is used to bootstrap it again.

### `GET /bridge` (WebSocket)

The WebSocket request must have an explicit extension Origin such as
`chrome-extension://<id>` (Chrome) or `extension://<id>` (Edge; some Chromium
hosts expose `edge-extension://<id>`). The first text message must contain the
session token obtained from `/api/v1/bootstrap`:

```json
{
  "type": "hello",
  "protocol": "chatgpt-comfy-connector.bridge/1",
  "client": "browser-extension",
  "token": "<session_token>"
}
```

The Desktop replies with `hello.ack`, then sends one server event:

```json
{
  "type": "event",
  "event": "desktop.ready",
  "event_id": "<id>",
  "timestamp": "<ISO-8601>",
  "data": {
    "message": "Desktop Connector is ready",
    "bridge_version": "0.2-alpha",
    "bind_address": "127.0.0.1",
    "port": 43127
  }
}
```

The Extension sends a ping and receives a pong on the same authenticated
socket:

```json
{ "type": "ping", "id": "<request-id>" }
{ "type": "pong", "id": "<request-id>", "timestamp": "<ISO-8601>" }
```

The Desktop may send internal events through `IBrowserExtensionBridge` using
the same `event` envelope. Phase 2 also sends one explicit Handoff request
over the authenticated socket:

```json
{
  "type": "handoff.send",
  "request_id": "<attempt-id>",
  "session_id": "<creation-session-id>",
  "handoff_id": "<pending-handoff-id>",
  "boundary_id": "<pending-boundary-id>",
  "payload": "<the exact existing Bootstrap Handoff text>"
}
```

The Background service worker resolves the request to its one active Managed
ChatGPT Tab in the connector-owned Execution Window using Conversation ID/URL
as the durable identity. It contains no DOM locator code. When the tab is new
or was navigated, `windows.create`, `tabs.create`, or `tabs.update` can resolve
while the document is still loading, so a missing
Content Script is retried after the tab reaches `complete`, before the MV3
injection fallback is attempted. The Background then requires the explicit
Content Script, Conversation, Composer, and response-watcher readiness
handshakes. The target Conversation identity is not changed during this wait.
The Content Script returns a result, which the Background forwards to the
Desktop:

```json
{
  "type": "handoff.result",
  "request_id": "<attempt-id>",
  "handoff_id": "<pending-handoff-id>",
  "status": "sent",
  "stage": "user_message_correlated"
}
```

After a newly loaded ChatGPT page receives the relay, the Content Script waits
for the concrete Composer to mount before attempting input. This bounded wait
does not relax the Composer or Send-button selectors; `composer_not_found` is
returned with `stage: "composer_mount_timeout"` only after that mount window
expires.

On failure, `status` is `error` and the response contains `error_code` and a
short `message` and, when the Content Script reached a concrete phase, a safe
`stage`. Supported DOM/target errors include
`managed_tab_not_chatgpt`, `managed_tab_create_failed`,
`managed_tab_navigation_failed`, `target_conversation_not_found`,
`target_conversation_mismatch`, `content_script_unavailable`, `composer_not_found`,
`composer_input_failed`, `composer_input_verification_failed`,
`send_button_not_found`, `send_not_ready`, and `send_failed`. For example, an
editor whose text is visible but whose Send control remains disabled returns
`composer_input_failed` with `stage: "send_button_not_enabled"`; an editor
whose structural Handoff identifiers cannot be confirmed returns
`composer_input_verification_failed` with
`stage: "input_identifiers_missing"`; a click that only clears the composer
returns `send_failed` with `stage: "user_message_not_observed"`. Desktop-side
delivery failures use `bridge_disconnected`. The payload is never echoed in a
result or written to logs.

The DOM locator does not select an arbitrary nearby button. It ranks explicit
send/submit semantics and same-composer-form submit controls, while rejecting
attachment/upload/add/plus/tools/microphone/voice/stop semantics in both
English and Japanese. A button outside the selected composer scope is also
rejected, and equally ranked Send candidates are treated as ambiguous rather
than guessed. After the click, the Content Script records the user-message set
before sending and reports `sent` only after a newly added user message has
both the current `handoff_id` and `boundary_id` (and the Handoff protocol when
available). Clearing or replacing the composer alone, including opening the
`+` menu, is therefore a `send_failed` result. The input path is separated by
DOM type: a textarea uses its native value setter plus one `input` event;
contenteditable uses a selected-range `execCommand("insertText")` operation,
with a conditional editor paste route only if that operation is rejected. No
direct `textContent` assignment is used as an input fallback.

The Content Script emits safe stage diagnostics such as
`composer_found`, `input_attempted`, `input_identifiers_found`,
`input_visible`, `send_button_found`, `send_button_enabled`, `send_clicked`,
`composer_cleared`, `user_message_observed`, and `user_message_correlated`.
Input verification additionally records only boolean presence for `protocol`,
`handoff_id`, and `boundary_id`; it does not compare or log the Handoff body.
These contain only request/handoff identifiers and outcome metadata, never
credentials or the Handoff body.

The Background asks the same Content Script to prepare the response watcher
before sending the Handoff. The pre-send watch records the assistant-message
baseline, then anchors itself only to the newly confirmed user message after
that Handoff is visible. It is never started for a copied or failed Handoff.
After `handoff.result` is confirmed as `sent`, the same watcher continues
without changing its correlation identity. The Content Script uses the
assistant-message locator, a message-content locator, `MutationObserver`,
polling, text-stability, and the generating/stop control state to distinguish a
completed answer from a streaming answer. Status/live-region text such as
thinking, tool progress, and image-generation progress is excluded. A
candidate is not eligible until that assistant message contains a
`connector-command` code block (or the equivalent fenced text) and its
  response is stable and correlated to the anchor. The watcher uses completion
  actions on that assistant turn as per-message completion evidence; a page-wide
  Stop control that remains visible for unrelated work does not keep an already
  stable Review response in the streaming state. A Stop control without
  per-message completion evidence still keeps the watcher waiting:

```json
{
  "type": "assistant.response",
  "request_id": "<same-send-attempt-id>",
  "session_id": "<creation-session-id>",
  "handoff_id": "<pending-handoff-id>",
  "boundary_id": "<pending-boundary-id>",
  "status": "received",
  "payload": "<assistant response text>",
  "stage": "assistant_response_complete"
}
```

Response failures use `status: "error"` with a safe `error_code` and `stage`,
including `assistant_response_not_found`, `response_timeout`,
`response_stream_interrupted`, and `response_extraction_failed`. The
Background relays this envelope without inspecting its DOM or parsing its
payload. The Desktop then matches all durable IDs and the latest send
attempt, requires the outgoing Handoff to be `SENT`, and invokes the existing
`ConnectorProtocol.Parse` strict validator. Only a valid response is copied
into `CHATGPT COMMAND` and recorded as `RECEIVED`. A valid `generate` response
then enters the existing Desktop APPLY/GENERATE path automatically; a valid
`complete` response uses the existing output-and-review completion guard.
Manual `読み込んで確認`, `適用`, and `適用して生成` remain available for
inspection, recovery, and explicitly user-controlled operation.

The Content Script performs DOM-aware extraction before this Desktop boundary.
Because Markdown rendering removes the source fence from a rendered
`<pre><code>` block, a block explicitly labelled `connector-command` is
reconstructed as the canonical
````text
```connector-command
{JSON}
```
````
form. If the renderer removes the language label too, the response watcher
uses the already-correlated `protocol`, `handoff_id`, and `session_id` fields
of the command-shaped block as a narrow fallback discriminator. Raw
`COMFY_PAYLOAD` text is preserved as-is. This is extraction formatting only;
the Desktop strict parser remains the authority and no JSON-plus-Payload
grammar is accepted by the Extension.

The server accepts only `hello`, `ping`, `handoff.result`,
`assistant.response`, and `review.media.result` from the Extension; unknown
messages return an error and cannot invoke MCP, filesystem, workflow, or
process operations.

### Phase 5.1: generated media attachment

After a successful ComfyUI generation, the Desktop registers only the current
iteration's confirmed Primary Output in a process-local media registry. The
registry record contains an opaque `media_id`, session/iteration and output
identity, safe basename, allow-listed MIME type, exact byte size, an expiry,
and the Desktop-side allowed output root. `FullPath` and the root are never
serialized into a Bridge message.

The authenticated WebSocket carries metadata only:

```json
{
  "type": "review.media.attach",
  "request_id": "<attempt-id>",
  "session_id": "<creation-session-id>",
  "iteration": 1,
  "media_id": "<opaque-process-local-id>",
  "filename": "output.mp4",
  "mime_type": "video/mp4",
  "size": 123456,
  "target_conversation_id": "<conversation-id>",
  "target_conversation_url": "https://chatgpt.com/g/g-example/c/example"
}
```

The Background resolves the one Managed Tab from the target Conversation
identity, then downloads the registered bytes through the authenticated
loopback endpoint:

```text
GET /api/v1/media/{media_id}?session_id=<id>&iteration=<number>
Authorization: Bearer <current process session token>
X-Connector-Client: browser-extension
```

The response is streamed in bounded chunks to the Content Script. It contains
only the registered file bytes, safe filename, and allow-listed MIME type; it
does not expose an absolute path. The Content Script creates a browser `File`,
sets ChatGPT's real file input through `DataTransfer`, dispatches `input` and
`change`, and waits for a new filename/chip/preview indicator with upload
activity finished before returning:

```json
{
  "type": "review.media.result",
  "request_id": "<attempt-id>",
  "session_id": "<creation-session-id>",
  "iteration": 1,
  "media_id": "<opaque-process-local-id>",
  "status": "attached",
  "stage": "attachment_verified"
}
```

The failure response uses `status: "error"`, `error_code`, `stage`, and a
short message. Supported failures include `review_output_not_found`,
`media_registration_failed`, `media_expired`, `media_fetch_failed`,
`media_too_large`, `unsupported_media_type`, `target_conversation_not_found`,
`target_conversation_mismatch`,
`content_script_unavailable`, `attachment_control_not_found`,
`attachment_input_failed`, `attachment_upload_failed`,
`attachment_timeout`, `attachment_verification_failed`, and
`bridge_disconnected`. A missing tab, changed ChatGPT conversation, expired
registration, size/MIME mismatch, or incomplete upload never advances Review
to attached.

Only `video/mp4`, `image/png`, `image/jpeg`, and `image/webp` are registered
for this phase. Registrations expire after ten minutes, are cleared when the
Bridge stops, and are revoked when the session/context/generation changes or
after a successful attachment. The source ComfyUI output is never deleted.
Duplicate in-flight or already terminal same-iteration attachment attempts
are ignored by Desktop state guards; an explicit retry is available after a
failure. Phase 5.1 ends at `ATTACHED`; it does not itself create or send a
Review Handoff.

### Phase 5.2: automatic Review and next iteration

Once the media result is `ATTACHED`, Desktop creates a new Review Handoff for
the same session, Conversation identity, Managed Tab, and iteration. It has fresh `handoff_id` and
`boundary_id` values, and is sent through the same authenticated
`handoff.send` path. The Content Script first verifies that the expected
attachment is still visible, inserts the Review body, and waits for the
ChatGPT Send control to become enabled before clicking it. Video processing
can leave that control disabled after the attachment chip is visible, so the
Review path polls for up to 60 seconds; the Background and Desktop transport
windows are 75 and 90 seconds respectively. A disabled control is never
clicked and a timeout remains a retryable Review failure.

After a confirmed Review user message, the existing assistant-response
watcher returns the completed response to Desktop for strict validation. A
validated `generate` response uses the existing APPLY → GENERATE path for the
next iteration; `complete` terminates the session. The maximum-iteration
safety stop, cancellation, stale-response rejection, and duplicate handling
remain owned by the Desktop/Core state machine.

### `POST /api/v1/ping`

The HTTP ping is an equivalent diagnostic endpoint. It requires the explicit
client header and `Authorization: Bearer <session_token>`. If the browser
supplies an Origin it must be an accepted extension Origin; a normal web-page
Origin is rejected.

```json
{ "id": "http-ping" }
```

The response is a `pong` envelope. CORS preflight is limited to the known
health/pair/bootstrap/ping paths, `GET, POST, OPTIONS`, the exact requesting
extension Origin, and the required headers. No
`Access-Control-Allow-Origin: *` response is emitted.

## State model

The Desktop exposes `Disconnected`, `Connecting`, `Connected`, and `Error`
through `IBrowserExtensionBridge.Status`, along with `Required` / `Paired`
pairing state. The Extension stores connection state and pairing metadata in
`chrome.storage.local`, while keeping the short-lived session token only in
Service Worker memory. It attempts pairing/bootstrap on install/startup, sends
a 20-second application-level WebSocket ping to prevent MV3 Service Worker
idle suspension, retries after a socket close, and uses a one-minute
`chrome.alarms` fallback so a Desktop restart can be detected even after the
Service Worker is suspended. A temporary loopback/network failure remains `DISCONNECTED` while
the reconnect loop is active; protocol or authentication failures are shown as
`ERROR`.

`desktop.ready` is retained as the last event in the popup. A successful PING
updates the last-pong timestamp. This gives a visible proof of both the
Desktop-to-Extension event path and the Extension-to-Desktop ping path.

The Desktop keeps the Handoff identity and exact body in `PendingHandoff` and
the persisted Handoff timeline. A successful Extension delivery records
`SENT` and moves `TO CHATGPT` to the normal ChatGPT-response waiting state.
Only a truly `DISCONNECTED` Bridge selects the original Clipboard path and
records `COPIED` with `ChatGPTへ貼り付け待ち`. `CONNECTING` or `ERROR` does not
silently fall back: it returns an explicit automatic-send error. If an
automatic send returns an error, the same body and identity remain in a
`FAILED` timeline entry: the same SEND action can retry it, or the timeline
copy action can use the Clipboard fallback. No session reset or
PendingHandoff regeneration occurs. A persisted `WAITING`/`FAILED` Bootstrap
can also be copied from its timeline card.

The central kickoff action is also the explicit retry surface. While the
current Bootstrap timeline entry is `COPIED` or `FAILED`, it remains enabled
and is labeled `CHATGPTへ再送` when the Extension is connected. With a truly
`DISCONNECTED` Bridge it is labeled `HANDOFFを再コピー` and copies the same
saved body instead. A Bridge status transition only refreshes this label and
hint; it never starts a retry without a user click. The retry path does not
re-run IDEA-stage preparation, so `session_id`, `handoff_id`, `boundary_id`,
and the exact persisted Handoff body remain unchanged. Only the transport
attempt's `request_id` is new.

## Security boundary

- loopback IPv4 binding and a loopback remote-endpoint check;
- extension-scheme Origin required for WebSocket and for HTTP responses when
  Chromium supplies it;
- Service Worker pairing/bootstrap/ping requests require the fixed
  `X-Connector-Client` header, and a non-extension web-page Origin is rejected;
- exact-Origin CORS headers, never wildcard CORS;
- one-time, ten-minute pairing code with a five-attempt limit;
- random pairing credential returned only by the pairing exchange; Desktop
  persists only its verifier/hash;
- random short-lived process session token returned only by authenticated
  bootstrap, required for WebSocket hello and HTTP ping, and never persisted;
- fixed localhost URLs in the background Service Worker; page messages cannot
  supply an arbitrary URL;
- no arbitrary command or MCP execution surface exposed to the Extension;
- bounded HTTP/WebSocket message sizes and a five-second hello timeout.
- Handoff, media, Review, and response delivery are limited to one active
  Managed HTTPS `chatgpt.com` tab inside the connector-owned Execution Window,
  resolved from the bound Conversation
  identity; the Background cannot choose an arbitrary URL and the Content
  Script cannot access the Bridge.
- Handoff bodies are not included in diagnostics or log messages.

The pairing credential is the long-lived trust relationship; the session token
is only a short-lived process capability. A later release can pin pairing to a
specific Extension ID or add explicit revoke/reset UI without changing the
message envelope. Automatic execution is still limited to the existing
strictly validated `generate`/`complete` actions; arbitrary commands and MCP
operations are not exposed to the Extension.

## Extension layout

```text
browser-extension/
├─ manifest.json          # Chromium Manifest V3
├─ background.js          # health, pairing, bootstrap, WebSocket, reconnect, managed-tab routing
├─ chatgpt-locators.js    # replaceable DOM locators and context metadata extraction
├─ content-script.js      # ChatGPT input/send and assistant response watcher
├─ popup.html             # connection and first-pairing UI
├─ popup.css
└─ popup.js
```

## Development loading

1. Build and start the current Desktop Connector executable. If an older
   instance is already running, close it first; rebuilding source files does
   not update an already-running WPF process. The Bridge starts with the
   application and listens on `127.0.0.1:43127`. Copy the `PAIRING CODE` shown
   in the Desktop's Browser Extension card.
2. Chrome: open `chrome://extensions`, enable **Developer mode**, choose
   **Load unpacked**, and select the repository's `browser-extension` folder.
3. Edge: open `edge://extensions`, enable **Developer mode**, choose **Load
   unpacked**, and select the same folder.
4. After changing the unpacked Extension files, press **Reload** on the
   Extension. The Background creates or reuses the connector-owned Execution
   Window and its active Managed ChatGPT Tab, and can inject the Content Script
   after its document is ready. Reloading the tab gives the cleanest development
   check. Open the Extension popup, enter the Desktop `PAIRING CODE`, and choose
   **PAIR DESKTOP**. It should move through `CONNECTING` to `CONNECTED`, show
   `desktop.ready`, and enable `PING`.
5. Select the desired Project/Chat in Desktop and press `SEND TO CHATGPT`.
   The active Managed ChatGPT Tab in the Execution Window should open or
   navigate to the bound Conversation, pass its readiness handshakes, and
   receive the exact Bootstrap Handoff; the Desktop timeline should show `SENT`.
   After ChatGPT finishes, its assistant response should be delivered through
   the Bridge, pass the Desktop strict Connector Response validation, appear in
   `CHATGPT COMMAND`, and create a `RECEIVED` timeline item. A `generate`
   response then automatically applies the validated slots, starts/waits for
   ComfyUI when needed, runs one Connector-owned Job, and updates OUTPUT/HISTORY.
   A `complete` response completes only after the existing review/output guard
   passes. The manual Command buttons remain available for recovery or
   deliberate inspection.
6. Switch the user's foreground tab to a non-ChatGPT page and press
   `SEND TO CHATGPT` again. The send must still use only the active Managed
   ChatGPT Tab in the connector-owned Execution Window; the foreground tab
   must not change the target or cause a duplicate Handoff. If the Managed Tab
   or its Execution Window is closed, it should be recreated at the bound
   Conversation URL and resume the pending correlated operation.
7. Stop the Desktop Connector. The popup should become `DISCONNECTED`; start
   it again and the Service Worker should bootstrap a new session token and
   reconnect automatically or after the next retry/alarm.

Chrome 116+ and Edge 116+ both consume the same Chromium Manifest V3 files;
no browser-specific source fork is required. The minimum version is explicit
because the WebSocket activity keepalive used by the Service Worker is
supported from Chromium 116.

## Verification

`tests/ChatGPTComfyConnector.Tests/BrowserExtensionBridgeTests.cs` covers
loopback health without token disclosure, exact extension/web-page Origin
handling, no-Origin Service Worker-style pairing/bootstrap, verifier
persistence, process-token rotation across restart, WebSocket hello,
ping/pong, `desktop.ready`, explicit Desktop events, `handoff.send` result
correlation, authenticated `assistant.response` transport without payload
parsing, disconnect failure, the Desktop SEND-before-Clipboard regression,
and the MV3/background/Content Script boundaries. `BrowserExtensionResponseCorrelationTests.cs`
covers sent-boundary correlation, copied/failed rejection, strict Connector
Response validation, transport errors, and the command confirmation state.
`CreationPipelineStateMachineTests.cs`
covers the separate SENT Bootstrap transition, explicit Clipboard waiting state,
retryable send failure while retaining the same PendingHandoff, the separate
ComfyUI startup/wait/generation substates, and complete/resume boundaries. The
automatic-response coordinator tests cover response identity idempotency and
safe persisted diagnostics. The bridge tests use an ephemeral loopback port so
they do not collide with production.

`tests/browser-extension/chatgpt-context.test.mjs` covers project/conversation
URL parsing, projectless chats, duplicate sidebar entries, current SPA context,
and metadata-only fallback behavior. The Bridge test also covers the
authenticated context request/response envelope.

`tests/browser-extension/content-script.test.mjs` uses only Node's built-in
test runner and a small DOM fixture to exercise textarea/contenteditable input,
safe selection beside an attachment/plus button, structural marker verification
under DOM whitespace/newline normalization, matching user-message send
confirmation, ID correlation, the conditional editor paste route,
non-ChatGPT rejection, missing locator errors, disabled-send/editor-state
handling, delayed Review Send readiness after media processing, and the
no-message/unrelated-message failure paths.

`tests/browser-extension/background.test.mjs` uses a mock WebSocket and
`chrome.tabs`/`chrome.windows` boundary to exercise active Managed-Tab routing
inside an isolated Execution Window independent of the foreground tab,
Content Script result relay, navigation/tab-disappearance and window-close
recovery, unavailable-Content-Script errors, assistant response
relay/correlation, MV3 WebSocket keepalive, idempotent Handoff delivery, and
safe diagnostic fields.

`tests/browser-extension/content-script.test.mjs` also covers response
anchoring after the matching user message, ignoring the previous assistant
answer, waiting for a stop/generating control to disappear, and explicit
response timeout reporting.

The locator API accepts an injected document/root in `findComposer` and
`findSendButton`, so fixture DOMs can exercise locator changes without a live
ChatGPT session. Assistant locators are similarly isolated and the Content
Script waits for a new assistant message after the confirmed user anchor; the
Extension does not duplicate the Desktop Connector Response parser.
