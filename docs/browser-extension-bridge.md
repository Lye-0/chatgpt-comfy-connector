# Browser Extension Bridge (v0.2 Phase 1)

## Scope

Phase 1 connects the Chromium Browser Extension to the running Desktop
Connector. It does not inspect or mutate ChatGPT, submit messages, read
responses, enumerate chats/projects, or apply/generate workflows.

```text
ChatGPT page content script
          ⇅ chrome.runtime
MV3 background service worker
          ⇅ HTTP health / pairing / bootstrap / WebSocket
http://127.0.0.1:43127
          ⇅
Desktop Connector Bridge
```

The content script has only a status-event placeholder. All localhost access
is owned by `browser-extension/background.js`.

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
the same `event` envelope. In this phase, the server accepts only `hello` and
`ping` from the Extension; unknown messages return an error and cannot invoke
MCP, filesystem, workflow, or process operations.

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

The pairing credential is the long-lived trust relationship; the session token
is only a short-lived process capability. A later release can pin pairing to a
specific Extension ID or add explicit revoke/reset UI without changing the
message envelope. No command execution surface exists in this phase.

## Extension layout

```text
browser-extension/
├─ manifest.json          # Chromium Manifest V3
├─ background.js          # health, pairing, bootstrap, WebSocket, reconnect
├─ content-script.js      # status-only placeholder; no ChatGPT DOM access
├─ popup.html             # connection and first-pairing UI
├─ popup.css
└─ popup.js
```

## Development loading

1. Start the Desktop Connector. The Bridge starts with the application and
   listens on `127.0.0.1:43127`. Copy the `PAIRING CODE` shown in the
   Desktop's Browser Extension card.
2. Chrome: open `chrome://extensions`, enable **Developer mode**, choose
   **Load unpacked**, and select the repository's `browser-extension` folder.
3. Edge: open `edge://extensions`, enable **Developer mode**, choose **Load
   unpacked**, and select the same folder.
4. Open the Extension popup, enter the Desktop `PAIRING CODE`, and choose
   **PAIR DESKTOP**. It should move through `CONNECTING` to `CONNECTED`, show
   `desktop.ready`, and enable `PING`.
5. Stop the Desktop Connector. The popup should become `DISCONNECTED`; start
   it again and the Service Worker should bootstrap a new session token and
   reconnect automatically or after the next retry/alarm.

Chrome and Edge both consume the same Chromium Manifest V3 files; no browser
specific source fork is required.

## Verification

`tests/ChatGPTComfyConnector.Tests/BrowserExtensionBridgeTests.cs` covers
loopback health without token disclosure, exact extension/web-page Origin
handling, no-Origin Service Worker-style pairing/bootstrap, verifier
persistence, process-token rotation across restart, WebSocket hello,
ping/pong, `desktop.ready`, an explicit Desktop event, and disconnect state.
The test uses an ephemeral loopback port so it does not collide with the
production Bridge.
