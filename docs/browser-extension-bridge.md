# Browser Extension Bridge (v0.2 Phase 1–2)

## Scope

Phase 1 connects the Chromium Browser Extension to the running Desktop
Connector. Phase 2 adds one narrow action: Desktop can deliver the already
generated Bootstrap Handoff to the currently active `chatgpt.com` tab, where
the Content Script fills the composer and submits it. Phase 2 does not read
the ChatGPT response, enumerate chats/projects, or apply/generate workflows.

```text
ChatGPT page content script (DOM only)
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

The existing `Connector → MCP → ComfyUI → GPU` header remains unchanged. The
right-hand `BROWSER EXTENSION / Desktop Bridge` card is a separate status
surface. When pairing is required, it displays a one-time pairing code; the
code is never included in health responses or logs.

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
short-lived, one-time code and displays it in the separate `BROWSER
EXTENSION` card. The user enters that code in the Extension popup. The
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

The Background service worker checks the active, last-focused tab and only
relays this request when its URL is `https://chatgpt.com/*`. It does not move
the user to another tab and contains no DOM locator code. If a ChatGPT tab was
already open when the unpacked Extension was reloaded, the Background uses the
MV3 `scripting` permission to inject `chatgpt-locators.js` and
`content-script.js` into that exact ChatGPT tab, then retries the message. The
Content Script returns a result, which the Background forwards to the Desktop:

```json
{
  "type": "handoff.result",
  "request_id": "<attempt-id>",
  "handoff_id": "<pending-handoff-id>",
  "status": "sent",
  "stage": "user_message_correlated"
}
```

On failure, `status` is `error` and the response contains `error_code` and a
short `message` and, when the Content Script reached a concrete phase, a safe
`stage`. Supported DOM/target errors include
`active_tab_not_chatgpt`, `content_script_unavailable`, `composer_not_found`,
`composer_input_failed`, `send_button_not_found`, `send_not_ready`, and
`send_failed`. For example, an editor whose text is visible but whose Send
control remains disabled returns `composer_input_failed` with
`stage: "send_button_not_enabled"`; a click that only clears the composer
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
`composer_found`, `input_attempted`, `input_visible`, `send_button_found`,
`send_button_enabled`, `send_clicked`, `composer_cleared`,
`user_message_observed`, and `user_message_correlated`. These contain only
request/handoff identifiers and outcome metadata, never credentials or the
Handoff body.

The server accepts only `hello`, `ping`, and `handoff.result` from the
Extension; unknown messages return an error and cannot invoke MCP, filesystem,
workflow, or process operations.

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
Service Worker memory. It attempts pairing/bootstrap on install/startup,
retries after a socket close, and uses a one-minute `chrome.alarms` fallback
so a Desktop restart can be detected even after the Service Worker is
suspended. A temporary loopback/network failure remains `DISCONNECTED` while
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
- no command execution surface in this phase;
- bounded HTTP/WebSocket message sizes and a five-second hello timeout.
- Handoff delivery is limited to the active, last-focused HTTPS `chatgpt.com`
  tab; the Background cannot choose an arbitrary URL and the Content Script
  cannot access the Bridge.
- Handoff bodies are not included in diagnostics or log messages.

The pairing credential is the long-lived trust relationship; the session token
is only a short-lived process capability. A later release can pin pairing to a
specific Extension ID or add explicit revoke/reset UI without changing the
message envelope. No command execution surface exists in this phase.

## Extension layout

```text
browser-extension/
├─ manifest.json          # Chromium Manifest V3
├─ background.js          # health, pairing, bootstrap, WebSocket, reconnect, routing
├─ chatgpt-locators.js    # replaceable composer/send locator candidates
├─ content-script.js      # ChatGPT composer input and send confirmation
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
   Extension and reload the already-open ChatGPT tab once. The Background can
   also inject the Content Script into an existing ChatGPT tab, but reloading
   gives the cleanest development check. Open the Extension popup, enter the
   Desktop `PAIRING CODE`, and choose
   **PAIR DESKTOP**. It should move through `CONNECTING` to `CONNECTED`, show
   `desktop.ready`, and enable `PING`.
5. Open a target `https://chatgpt.com/` conversation and keep that tab active.
   Press the Desktop `SEND TO CHATGPT` button. The exact existing Bootstrap
   Handoff should appear in the composer and be sent; the Desktop timeline
   should show `SENT`.
6. Make a non-ChatGPT tab active and press `SEND TO CHATGPT` again. The
   Desktop should report `active_tab_not_chatgpt` and retain the same pending
   Handoff; the Clipboard fallback remains available.
7. Stop the Desktop Connector. The popup should become `DISCONNECTED`; start
   it again and the Service Worker should bootstrap a new session token and
   reconnect automatically or after the next retry/alarm.

Chrome and Edge both consume the same Chromium Manifest V3 files; no browser
specific source fork is required.

## Verification

`tests/ChatGPTComfyConnector.Tests/BrowserExtensionBridgeTests.cs` covers
loopback health without token disclosure, exact extension/web-page Origin
handling, no-Origin Service Worker-style pairing/bootstrap, verifier
persistence, process-token rotation across restart, WebSocket hello,
ping/pong, `desktop.ready`, explicit Desktop events, `handoff.send` result
correlation, disconnect failure, the Desktop SEND-before-Clipboard regression,
and the MV3/background/Content Script boundaries. `CreationPipelineStateMachineTests.cs`
covers the separate SENT Bootstrap transition, explicit Clipboard waiting state,
and retryable send failure while retaining the same PendingHandoff. The bridge
tests use an ephemeral loopback port so they do not collide with production.

`tests/browser-extension/content-script.test.mjs` uses only Node's built-in
test runner and a small DOM fixture to exercise textarea/contenteditable input,
safe selection beside an attachment/plus button, matching user-message send
confirmation, ID correlation, the conditional editor paste route,
non-ChatGPT rejection, missing locator errors, disabled-send/editor-state
handling, and the no-message/unrelated-message failure paths.

`tests/browser-extension/background.test.mjs` uses a mock WebSocket and
`chrome.tabs` boundary to exercise active-ChatGPT routing, non-ChatGPT rejection,
Content Script result relay, tab-disappearance/unavailable-Content-Script
errors, and safe diagnostic fields.

The locator API accepts an injected document/root in `findComposer` and
`findSendButton`, so fixture DOMs can exercise locator changes without a live
ChatGPT session. The Content Script waits for a new matching user message; it
does not inspect assistant responses.
