# Architecture

## Boundaries

```text
WPF Desktop
  ├─ MainViewModel: user flow, dirty/session/job presentation
  ├─ Core: domain models, path safety, Protocol v1, context builders
  └─ Infrastructure
       ├─ PortableStore: atomic settings/session/pairing-verifier JSON, logs, backups
       ├─ WorkflowCatalog: filesystem tree + dynamic MCP slot/job mapping
       ├─ ComfyMcpClient: official C# SDK StdioClientTransport
       ├─ ComfyUiEndpointHealthProbe: direct ComfyUI HTTP runtime check
       └─ BrowserExtensionBridge: loopback HTTP/WebSocket transport

Chromium Browser Extension (Manifest V3)
  ├─ Content Script: ChatGPT DOM input, attachment, and response observation
  └─ Background Service Worker: Bridge health, pairing/bootstrap, WebSocket, state, ping, managed-tab lifecycle
```

## Project / Chat context providers

Project and Chat selection is provider-neutral at the UI and Session boundaries.
`IProjectChatProvider` supplies a `ProjectChatCatalog` made of `ProjectContextOption`
and `ChatContextOption` values. The current `LocalProjectChatProvider` is one
implementation backed by `chatgpt-contexts.json`; future Browser Extension or
Handoff providers can be injected into `MainViewModel` without changing the
selection UI or the creation flow.

`CreationSession` persists `ContextProviderId`, `ProjectContextKey`, and
`ChatContextKey` as the canonical binding. The older `LocalProjectContextId` and
`LocalChatContextId` fields remain only as a compatibility fallback for existing
session JSON and are populated for the local provider.

The UI never accepts an absolute Workflow path from a ChatGPT command. A GUI-selected `WorkflowIdentity` is the authority. Every operation resolves a relative path beneath the configured Workflow root and rejects traversal or overwrite.

## Save and generation sequence

```text
draft in UI
  → external fingerprint check
  → one pre-save backup
  → set_workflow_slot(stdout=false)
  → validate_workflow(valid=true required)
  → run_workflow(wait=false)
  → job(action=status/cancel)
  → resolve job output metadata (filename/subfolder/type)
  → resolve the existing ComfyUI output path
  → fetch_outputs only when needed, using an isolated staging directory
    and restoring each file to its reported relative subfolder
  → Session Iteration persistence
```

If slot application or validation fails, the pre-save backup is restored. Backup retention is three JSON generations per logical Workflow. Restore itself first creates a backup of the current file.

`filename_prefix` is a ComfyUI-relative prefix, not a Connector filename. The
Connector does not replace it with a prompt or handoff id: unchanged slots are
not resent on every Apply, and an explicit prefix override retains the original
relative directory (for example, `video/`) while allowing its leaf name to
change. Output artifacts keep their actual local `FullPath` for preview,
history, OPEN, and resume; the public Handoff serializer continues to expose
only safe output metadata.

## Creation Session and pipeline

`CreationSession` is the durable unit of a production. It binds the GUI-selected
`WorkflowIdentity`, a provider-neutral Project / Chat reference, and an optional
kickoff instruction, iteration history, Handoff messages, and the current pipeline
snapshot. Sessions are
stored as JSON files below `data/sessions/`; rebuilding the application does not clear
this history.

The pipeline is an ordered state machine:

```text
Connect → Workflow → Chat → Idea → ToChatGpt → Command → Apply → Generate → Output → Review
```

Connect is the first production gate, not a duplicate of the header telemetry. It is
completed when the MCP transport is connected; ComfyUI running state is deliberately not
part of this gate. Connecting uses `InProgress`; a mid-session MCP disconnect uses
`WaitingUser`; transport failure uses `Error`. Workflow and Chat can proceed while
ComfyUI is stopped.

Workflow owns the library/file read, GUI selection, Slot Schema discovery and
preparation. It becomes complete only for a selected Workflow with successfully
loaded schema (a successfully discovered empty schema is valid). File and schema
failures belong to Workflow. The asynchronous discovery generation is checked
after both schema and backup reads before publishing slots, backups or completion.

Chat owns provider-neutral Project / Chat discovery and selection, target identity
validation, and ChatGPT Context binding. Catalog loading, selected-Project Chat
loading, disconnected discovery and errors remain distinct. A ready Project / Chat
and a 1–1000 maximum-iteration budget permit explicit creation start; Chat becomes
complete after binding. New sessions are persisted before workspace activation,
so failed persistence stays a retryable Chat preparation error and does not replace
an existing workspace. Both `WorkflowBound` and `ChatBound`, and both completed
stages, are required before Idea/Handoff/Command may advance.

`CreationPreparationPolicy` evaluates Workflow and Chat separately and is shared
by the start guard and draft pipeline synchronization. Before activation, the
draft pipeline shows actual discovery loading/errors under their owning stage;
successful inputs advance in Connect → Workflow → Chat order. Chat stays current
until creation start. During an active session, selectors/readiness describe the
next draft; refreshing or changing them cannot rewrite bound pipeline milestones,
the Handoff target, media registration or downstream history. Explicit rebind uses
`BindWorkflow` then `BindChat`, invalidates pending handoff/response boundaries,
and retains iteration/output history. A failed Chat rebind leaves Workflow complete
and blocks downstream execution until Chat is successfully bound again.

Pipeline snapshot v8 appends Workflow/Chat enum values without renumbering older
stages. Initialization migrates the legacy `Context` entry and `contextBound` flag
into independent binding flags and stages; new JSON omits the combined flag.
Completed legacy bindings preserve downstream states/timestamps, pending Handoff,
Run and history. An unfinished combined stage cannot identify which preparation
failed, so it requires preparation checks again without inventing completion.
Sessions predating pipeline persistence retain legacy restoration; newly constructed
sessions must pass explicit binding and cannot infer readiness from selected fields.

The initial handoff must be explicitly sent/copied to ChatGPT before a command can be
validated. A validated `generate` command enters Apply, where slot changes are
backed up, written, saved, and validated before Generate is enabled. A completed Job
must produce at least one existing output before Review becomes available. `complete`
is accepted only from a Review state after a successful output; it preserves all
iterations and outputs. A completed Session can be explicitly resumed without
clearing its Output Viewer or iteration history. RESUME changes the Session back
to Active, reopens Review, and invalidates the consumed Pending Handoff so the
next Review Handoff receives fresh `handoff_id` / `boundary_id` values while
retaining the same `session_id`. Reaching the iteration limit creates an
explicit user decision stop rather than silently starting another iteration.

Each persisted `SessionIteration` also records its history `Outcome` separately
from the ComfyUI `JobStatus`: a successful normal iteration is `Generated`, a
Run stopped at its budget is `LimitReached`, and a ChatGPT `complete` response
is `ChatGptComplete`. `IsFinal` is an independent Session-level projection and
is true for exactly one current final output while the Session is completed.
Resuming preserves the old outcome labels but clears the old `IsFinal` marker;
the next completed iteration can then become the new final item without
rewriting prior history.

The initial `SEND TO CHATGPT` action is governed by the Core
`CreationWorkspacePolicy` and is exposed by the ViewModel as
`CanSendToChatGpt`. It requires an explicitly activated session with both Workflow
and Chat binding complete,
loaded slot schema, connected MCP, an IDEA stage that is still current (or
waiting for user input), and no active Job. The Idea field is an optional
kickoff/additional instruction, so an empty value is valid and tells ChatGPT to
use the selected conversation's existing messages as the production context.
ComfyUI runtime readiness is intentionally excluded because the initial handoff
does not execute a ComfyUI-dependent operation.

At startup, persisted sessions are loaded only as internal data for provider
bindings and future recovery. They are not expanded into the visible Workspace:
the current session is a fresh, non-persisted draft with an empty idea, command,
handoff timeline, output, and iteration history, and the pipeline starts at
Connect. `StartNewCreationAsync` is the explicit activation boundary: it creates
and persists a new session only after the MCP, Workflow/slot schema, Project,
Chat, and maximum-iteration prerequisites pass. `ResumeSessionAsync` remains the
explicit reactivation path for a completed/paused/stopped/error session and is
not an automatic startup recovery mechanism.

Connection loss never resets the Session, Workflow selection, Project / Chat, original
idea, iterations, or outputs. It moves Connect back to `WaitingUser` or `Error` and
blocks connection-dependent Apply/Generate operations. A successful reconnect completes
the same gate and resumes the existing Session from its retained production stage.

`WaitingUser` is a shared state, while `CreationStageStatus.WaitingReason` carries the
specific reason. The Core projection resolves that pair into concise UI text: a
defensive/manual ComfyUI gate may use `ComfyUI起動待ち`, a disconnected MCP gate uses
`再接続待ち`, ToChatGpt uses `ChatGPT返答待ち`, Review uses `レビュー返答待ち`, and the
iteration safety stop uses `続行判断待ち`. The automatic GENERATE startup path is
`InProgress` with `ComfyUI起動中`, so the UI must not display the enum name or a generic
`ユーザー待ち` label while the runtime is simply loading.

The small helper text at the top-right of the Creation Pipeline is resolved by
CreationPipelineLoopText. It selects the most recently updated active stage in
the ordered Core state machine and combines that stage with its state, the
current idea input, or a structured waiting reason. This keeps messages such as
"IDEA → SEND TO CHATGPT（入力は任意）", "GENERATE → 生成中", and
"REVIEW → レビュー返答待ち" aligned with the actual pipeline state instead
of using the broad Active session status as a shortcut.

ComfyUI readiness is checked immediately before operations that need it, through the
ViewModel's shared direct-health coordinator. GENERATE uses the same coordinator for
both Apply + Generate and standalone Generate: a READY endpoint proceeds immediately,
while STOPPED starts the configured ComfyUI batch once, keeps GENERATE `InProgress` with
`ComfyUI起動中`, polls `AppSettings.Endpoint`, and submits the original Job only after
READY. A startup timeout or launch error becomes a GENERATE error with a retryable
message; the normal path never asks the user to start ComfyUI and try again. The
defensive `RequireComfyUi` transition remains available for non-generating callers and
legacy snapshots, but is not used by the automatic GENERATE path. Context, Idea, and
Manual Handoff remain usable while ComfyUI is stopped, and CONNECT itself is never
downgraded merely because ComfyUI is stopped.

The Desktop header owns one independent `ComfyUiRuntimeState` and refreshes it with a
lightweight direct HTTP health check against `AppSettings.Endpoint` (`/system_stats`).
This check runs whether MCP is connected or disconnected, so `MCP未接続 · ComfyUI READY`
is represented without conflating the two facts. `START COMFYUI` sets `STARTING`
immediately and shares the same single-flight launch/poll operation; an unavailable
endpoint keeps that state while the bounded startup probe retries, and a successful
response changes it to `READY`. Normal unavailable probes resolve to `STOPPED`,
launch/probe configuration failures to `ERROR`, and `server_info` remains available
only for optional MCP-provided details such as GPU information. CONNECT never launches
ComfyUI and only reflects MCP transport readiness.

## Handoff transport and timeline

v0.1 uses a manual clipboard transport: Connector creates a Bootstrap / Review
Handoff, the user pastes it into the selected ChatGPT conversation, and ChatGPT's validated
`comfy-connector/1` Connector Response is pasted back into the Connector. A Response
contains exactly one small JSON object (preferably in a `connector-command` fence; `json`,
an unlabeled fence, or fence-less raw JSON are accepted) and zero or more referenced raw
`COMFY_PAYLOAD` blocks. A fence-less object may be surrounded by short explanatory text;
unsupported fences and multiple objects remain rejected. Connector-generated `handoff_id`, `session_id`, and
`boundary_id` bind the response to a persisted Pending Handoff snapshot containing its
immutable `Purpose` (Bootstrap or Review),
AllowedActions, Workflow identity, Project / Chat provider and context keys,
Iteration, kickoff instruction, and the MCP-discovered slot schema plus its
ChatGPT exposure policy.
The Handoff uses the existing ChatGPT conversation as context when available;
the optional kickoff instruction is prioritized as an additional instruction, and
Workflow / slot schema data remains sufficient for a new Chat with no history.
Validation therefore does not trust stale clipboard text or transient UI state.

Once a Bootstrap Handoff is issued, its Pending Handoff identity and captured
source remain immutable while the Workflow, slot schema, Iteration, and kickoff
instruction are unchanged. Re-copying or connection/status refreshes never
rotate that identity. A new Pending Handoff is created only for the first send
or an explicit re-send after the production Context changes; a response is
accepted only against the snapshot that issued it.

Free-form string slots use payload references; numeric, boolean, and choice values
remain direct JSON, but transport capability does not imply ChatGPT writability.
`ChatGptSlotPolicy` exposes only recognized creative controls, hides filesystem,
model, and internal-expression settings, defaults unknown slots to Hidden, and makes
enum/dynamic-combo slots ReadOnly when allowed choices are unavailable. The Pending
Handoff snapshot—not the current editor state—is the validation source of truth.
Slot discovery distinguishes NotLoaded, Loading, Loaded, and
Failed, so an unavailable schema is never silently exported as an empty slot list.
Every slot address is canonicalized with the Protocol's case-insensitive comparer
before it reaches the editor or Pending Handoff. Identical duplicate records are
collapsed at discovery; conflicting records and duplicate addresses in persisted
Pending Handoffs are rejected as validation errors. Async discovery responses from
an older selection/reconnect generation are ignored rather than appended to the
current collection.
The detailed grammar and validation invariants are canonicalized in
`docs/connector-protocol-v1.md`. Clipboard and the authenticated Browser Extension
Bridge are transport boundaries; the Protocol and Pending Handoff models remain
reusable by either provider.

The persisted
`HandoffMessage` separates transport direction, message kind, display text, secondary
metadata, and the full payload. The three semantic directions are
`CONNECTOR → CHATGPT`, `CHATGPT → COMFY`, and `COMFY → CHATGPT`; the initial creation
bootstrap is Connector → ChatGPT, not a Comfy result. Timeline cards may shorten only
the visible display text, while copy actions continue to use the full payload.

Incoming Connector Response timeline identity is based on the persisted direction,
message kind, and full payload. This includes the protocol/session/handoff/boundary
identity carried by the payload, so the same parsed response remains one card when
the automatic command-import projection omits its optional iteration number. Outgoing
generation and result messages continue to include the iteration projection in their
identity.

The older `Summary` field remains a compatibility fallback for sessions written
before the content-first card model. Existing messages are normalized when loaded so
legacy direction, kind, display text, and metadata do not break the timeline.

Review Handoff output metadata is intentionally public-safe: the copied payload
contains only a basename, MIME type, `local_only=true`, and non-sensitive availability
metadata. `OutputArtifact.FullPath` remains internal to the Connector for preview,
history, OPEN, and resume operations and is never serialized into ChatGPT-facing
Review Handoffs.

The OUTPUT VIEWER's `SAVE COPY` action is a non-destructive local copy of the
currently displayed `SelectedPreviewOutput`, including a History-selected older
iteration. The Windows standard SaveFileDialog supplies the initial basename,
extension, and overwrite confirmation; the source Output is never moved or
deleted. The copy operation rejects missing sources and silent overwrites so
filesystem errors are surfaced to the user.

HISTORY video cards capture a still frame only after the WPF media decoder reports
usable natural dimensions. Seek and playback capture use bounded retries and reject
blank frames before caching them. If a usable thumbnail cannot be captured, the card
shows an explicit unavailable state while the existing OUTPUT viewer and `OPEN`
fallback remain available.

## Production UI information architecture

Timeline Copy is a pure re-copy operation: when a card has a persisted
Payload, the Desktop ViewModel returns that exact string without creating a new
handoff, rotating PendingHandoff, validating the current IDEA stage, or
changing the pipeline. Result Handoff copying follows the same reuse rule;
payload generation is only a fallback when the current review boundary is new
(for example after RESUME) or an iteration has no saved Handoff payload yet;
the previous result card is never rewritten.

The desktop surface keeps three responsibilities distinct:

- left: Workflow library, selection, duplicate/rename, and the detailed Workflow
  editor entry;
- center: Creation Pipeline, idea input, current output preview, generation status,
  and iteration history;
- right: Handoff Timeline, ChatGPT command import/validation/apply, and Session
  resume controls.

Timeline direction is a separate visual semantic from transport status: Connector →
ChatGPT uses cyan, ChatGPT → Comfy uses a restrained purple-blue, and Comfy →
ChatGPT uses green. The card border, direction label, and timeline dot share that
direction palette, while RECEIVED / COPIED / WAITING / COMPLETED / ERROR badges
continue to resolve through the state palette. Hover and keyboard focus do not
replace the direction border colour.

The header's `Connector → MCP → ComfyUI → GPU` indicators describe detailed system
connectivity. Pipeline Connect is a concise gate derived from the same Core connection
readiness decision and indicates whether production can proceed; neither replaces the
other. Workflow slots remain dynamically loaded
and are edited in the dedicated Workflow settings view rather than making the
creation canvas a low-level slot editor. The UI does not infer completion from a button
click: both execution guards and stage rendering use `CreationPipelineStateMachine` as
their source of truth.

## Process lifecycle

`ComfyMcpClient` starts the configured `comfy-mcp.exe` using `StdioClientTransport` with a minimal environment plus `COMFY_BIN`, `COMFY_PROJECT`, and `COMFYUI_URL`. The current runtime's initialize-capable MCP revision (`2025-06-18`) is requested explicitly. Standard error is captured into the Portable log; if the transport closes unexpectedly, the SDK's process ID, exit code, and stderr tail are recorded as one diagnostic entry. Connector shutdown disposes the MCP client and child process; it never stops ComfyUI.

The app does not call ComfyUI management tools such as model download, node installation, update, or version switching.

## Browser Extension Bridge

v0.2 Phase 1–5.2 adds a local transport boundary and a narrow ChatGPT Handoff /
Response path for the Chromium Extension. The
Core `IBrowserExtensionBridge` contract and shared state/message models are
implemented by `Infrastructure/Bridge/BrowserExtensionBridge`. The server uses
the built-in .NET `HttpListener` WebSocket upgrade and binds only to
`http://127.0.0.1:43127/`; it is not part of the MCP server or ComfyUI
endpoint. `App.xaml.cs` is the manual composition root and injects one Bridge
instance into `MainWindow` / `MainViewModel`, so the listener starts with the
Desktop initialization and stops on the close/exit path.

The Background service worker owns one connector-created Managed Execution
Window with one active Managed ChatGPT Tab for all execution operations. The
Execution Window is created non-focused and non-minimized; its tab is active
within that window and has automatic discarding disabled. At first creation,
the Window uses approximately half the last-focused browser window's width and
height (roughly one quarter of its area), with a bounded fallback size.
Conversation ID/URL
is the durable target identity and the window/tab are only replaceable browser
media. Project/Chat metadata discovery uses a separate non-focused Collector
Window with one active Collector Tab. The Collector Window is created or
reused only for metadata discovery: a root refresh scans the root sidebar for
the complete Project catalog and Projectless Chats, while a selected Project
request visits only that Project page to load its Chats. It is never used to
send a Handoff or observe an assistant response. It uses roughly half the
reference window width and height, with an outer-width floor of about 820px,
and probes the Content Script's `window.innerWidth` and sidebar readiness
before discovery. A bounded zero-Project result is an
`context_projects_incomplete` error rather than a successful empty catalog;
the Desktop keeps a known cache visible while marking that refresh as Error.

Root discovery keeps confirmed Project descriptors and provisional observations
separate. Background retains their observation roles and diagnostic provenance
through Identity dispatch and retries; an Identity response cannot reclassify
them. A provisional observation joins an existing Project only with duplicate
identity evidence, becomes a separate Project when it resolves to a distinct
Stable ID, and keeps the refresh incomplete when it cannot be proven. Title,
position and predecessor keys alone do not authorize merging or discarding it.
After resolution and collision checks succeed, Background records the finalized
catalog count on that request. Final result validation requires that exact count,
so proven reconciliation can reduce the input count without allowing later
Project loss or unexpected additions.

After a Root More click, the existing bounded quiet interval observes row
locator and identity attributes as well as child/text changes. Attribute-only
pagination hydration restarts that interval before the new snapshot is admitted.
The quiet interval and timeout limits are unchanged; this gate does not replace
or discard an observation already in the catalog. More settling reports observed
attribute mutations, quiet completions and timeout completions. Identity failure
summaries include these counters and Root provisional provenance so the failed
rows can be traced from a single diagnostic object, without logging titles or
raw locator values.

When a More control lies below the containing Sidebar viewport and that
container can advance, Root defers the click until its ordinary downward scan
reaches the control. Intermediate snapshots are still collected, and deferral
does not mark pagination exhausted. If the scan budget ends with More pending,
Root remains incomplete. Missing geometry, controls already above the viewport
and containers that cannot advance retain the existing activation behavior.
Viewport geometry only schedules pagination; it does not establish Project
identity. Efficiency and failure summaries distinguish deferred checks and
clicks inside, outside or without measurable viewport bounds.

For each newly created provisional observation, Root also records a bounded
comparison with the earlier same-title catalog observation. The comparison
reports snapshot, scroll and More-click counts; whether the row, parent and
Sidebar nodes are shared; whether the earlier row remains connected; and which
locator attribute groups changed. It distinguishes remounts, attribute changes
on a retained row, and position-only fingerprints. These are diagnostic
relations, not identity evidence. DOM witnesses and raw attribute values stay
local to that Root scan and are released in its `finally` block. Only numeric,
boolean and enumerated fields from at most 64 comparisons reach Content Script,
Background efficiency logs and the consolidated Identity failure summary.

Root Project identity resolution has a conservative in-memory incremental path
in `chatgpt-locators.js`. After an owned DOM identity is resolved, the exact row
object and its raw stable `data-*` attributes can authorize reuse on a subsequent
refresh in the same document and Sidebar. The stable locator must be unique in
the logical catalog, the raw attributes must be unique among current rows, and
the normal descriptor fingerprint checks still apply. Titles, positions, volatile
DOM attributes and hashed locator keys alone never authorize reuse. Reuse does
not merge, add or remove catalog descriptors. Provisional observations cannot use
this path. Remounted rows, replaced Sidebars/documents, changed keys, conflicts
and entries older than five minutes fall back to normal DOM resolution; a cache
hit does not extend the lifetime from the last actual DOM proof. Concurrent
resolver passes cannot let an older pass publish newly learned bindings.

This cache is not persisted or shared between tabs and does not change startup,
navigation fallback, visibility recovery or selected-Project Chat retrieval.
The `collector_project_identity_phase_performance_summary` event reports
`incremental_reuse_eligible_count`, `incremental_reuse_hit_count`,
`incremental_reuse_miss_count`, `incremental_reuse_rejected_count`,
`incremental_reuse_learned_count` and `incremental_reuse_no_proof_count`.
Eligibility/miss/no-proof counts cover unresolved rows inspected in the immediate
pass; rejection can also occur while checking a row already resolved by Root.
Compare two manual refreshes with the same Collector page, watching these counts,
`disclosure_required_count`, child-region wait and total elapsed time. If no row
has stable attributes or the rows remount, the cache cannot eliminate disclosure
waits. Chrome measurements are required to establish the actual speedup.

After dispatching a disclosure click, DOM identity resolution allows the bounded
hydrate budget (normally 2.5 seconds) even when the owned region has not mounted
yet. The budget starts after dispatch, is not extended by mutation noise, and
finishes immediately when owned identity evidence arrives. A native click is
never replayed just because its DOM update is asynchronous; synthetic disclosure
events are used only if native click dispatch is unavailable or throws. Explicit
navigation probes retain their short budget. These rules avoid cancelling a
queued disclosure toggle or abandoning a region that mounts after the probe
deadline. The owned-evidence, fingerprint and navigation validation rules remain
in effect.

The initial Root Identity DOM pass may yield after a navigation-eligible row
exhausts its full hydration budget. The immediate owned-metadata scan still runs
across the catalog first. The response retains every descriptor and names the
unresolved trailing rows whose hydration has not started; Background validates
that list against the requested catalog. It then uses the existing navigation
fallback before spending successive hydration ceilings on the remaining rows.
After successful recovery, the existing fresh-Root DOM pass checks all remaining
unresolved rows. If fallback fails, a `resumed_dom` pass hydrates the deferred rows
before any of their navigation fallbacks are considered. Post-navigation and
resumed passes retain the normal hydration budget and do not yield again. A
failed Project continues to keep the overall catalog incomplete.

After a successful navigation and the normal fresh-Root DOM pass, unresolved
rows with a fingerprint mismatch or exhausted visibility search receive one
additional DOM recovery pass per index. This pass re-enumerates only those rows
against the full original catalog; it does not weaken identity constraints or
start another navigation. Already resolved rows are skipped. Ambiguous identity
and ID/URL conflicts are not included, and a repeated failure remains incomplete.
The `post_navigation_recovery` counters report attempted indices, resolved count
and elapsed time separately from the original post-navigation retry inputs.

Before hydrating an unresolved disclosure, Identity checks its position in the
containing Sidebar scrollport. A connected row clipped outside that viewport is
scrolled into view, followed by a bounded render opportunity (two animation
frames, at most 100 ms). This wait applies only after an actual scroll and does
not consume the child hydration budget. The exact mount, header attributes,
parent and Sidebar are revalidated before reading new owned evidence or clicking.
Hydration may add a Stable ID to a derived fingerprint while those mount details
remain unchanged; replacing the row or changing its header requires the normal
descriptor match. The current expanded state prevents a second toggle. A route
change during that render wait cannot supply an identity. Immediate owned-ID
hits and explicit navigation probes do not use this viewport preparation.
The phase summary exposes `identity_viewport_scroll_count`,
`identity_viewport_wait_ms` and `identity_viewport_revalidation_failed_count`.
After navigation/remount, successful relocation also supplies the selected row's
current fingerprint for this interaction check. A stale discovery fingerprint
must not reject a mount that the normal relocation policy just selected.
This interaction fingerprint does not replace the catalog descriptor or any
existing Stable-ID/stable-locator constraint, authorize a same-title merge, or
provide a Project ID. Identity still requires owned DOM evidence, and a further
row change during viewport preparation must pass revalidation.
Disclosure click diagnostics include the pass kind, before/after expanded state,
owned-region presence, child Chat link count, identity reason and child wait time.
The Console sanitizer preserves these fields, including false and zero values.
A dispatched click alone is not evidence that expansion occurred; these outcomes
distinguish unaccepted expansion from an expanded region with no child identity.

When an exact fingerprint is absent and only a same-title sibling is visible,
duplicate titles in the catalog do not by themselves stop visibility recovery.
The bounded Sidebar search may recover the original fingerprint in another
viewport; it never clicks or merges the visible sibling based on title. Exact
fingerprint/Stable-ID collisions and contradictory matched rows remain terminal.
If the original row is not recovered, its precise failure reason is retained
through DOM resolution and exposed as `identity_failure_reason` in the failure
summary. Provisional index/transition diagnostics retain their array types across
the Content Script boundary.

Within a single synchronous Identity inspection, Sidebar row enumeration,
controlled-region ownership results and candidate-element lists are shared by
the fingerprint and owned-identity readers. The sharing scope is released in
`finally` before any click, await or telemetry callback. A later inspection
re-reads the DOM, including region owners and all conflicting candidate IDs.
Identity inspection and its immediate-pass fingerprint reads use this scope;
selected-Project Chat retrieval does not. This avoids repeating Sidebar
enumeration for every child Chat without reusing identity across refreshes.

If a Root scan starts with expanded Project rows, each synchronous catalog
snapshot and container read also uses this sharing scope. Expanded child Chat
ownership checks otherwise multiply full-Sidebar enumeration during repeat
refreshes. The scope ends before every scroll, click or wait, and the next
snapshot reads the DOM afresh. The collapsed Root path keeps its existing read
behavior; wait budgets, traversal limits and completion criteria are unchanged.
The efficiency summary reports `root_expanded_project_count_at_start`,
`root_shared_read_hit_count` and `root_row_enumeration_count` for this path.
Sidebar pagination excludes More controls contained in a Project row or its
controlled child region, including retained hidden regions. Those controls page
Project Chats, so they cannot be clicked by Root discovery or keep its completion
check pending. Project catalog More controls outside those regions remain eligible.
The More-control filter shares synchronous ownership reads and releases them
before any control is activated.

The phase performance summary additionally reports `identity_inspect_count`,
`identity_inspect_total_ms`, `identity_row_validation_total_ms`,
`identity_owned_scan_total_ms`, `identity_shared_read_hit_count` and
`identity_row_enumeration_count`. Row validation and owned scan are components
of inspection time, not extra durations to add to it. Shared-read and enumeration
counts include immediate-pass fingerprint and pre-disclosure structure reads;
inspection time covers the immediate owned scan and each disclosure inspection.
`identity_child_region_wait_ms` remains the full elapsed interval after click,
including inspection and event-loop scheduling, rather than pure observer wait.

Before `handoff.send`, the
Background requires Content Script, Conversation, Composer, and shared
assistant-response watcher readiness. The watcher is pre-registered with the
current Handoff IDs, records the existing assistant-message baseline, and
anchors only to the new marker-bearing user message. Initial Handoff, media
attachment, Review Handoff, and resumed/next-iteration work reuse this same
managed route; a foreground tab is never selected as a fallback.

When navigation or tab closure replaces the Content Script, the Background
retains bounded correlation metadata, recreates/rebinds the active tab in the
Execution Window from the same Conversation identity, and re-arms the watcher.
It may recover an accepted send after a lost message-channel response, but it
never resends the same Handoff solely because the tab or Bridge connection
changed. Authenticated
Handoff and assistant-response envelopes remain queued until Desktop receipt is
acknowledged.

The protocol has metadata-only `GET /health`, one-time `POST /api/v1/pair`,
credential-gated `POST /api/v1/bootstrap`, token-gated `POST /api/v1/ping`, and
token-gated `GET /bridge` WebSocket endpoints. The Desktop displays a short-
lived pairing code; the Extension stores the resulting pairing credential in
`chrome.storage.local`. The Desktop stores only a SHA-256 verifier in
`config/browser-extension-pairing.json`. On every Desktop start, the saved
credential bootstraps a new short-lived process session token, which is then
used for the WebSocket hello. The Desktop sends `hello.ack` and one
`desktop.ready` event; the Extension sends `ping` and receives `pong`. Phase 2
adds an authenticated `handoff.send` message carrying the exact Bootstrap
Handoff text and a correlated `handoff.result` response. The Background owns
one active Managed `https://chatgpt.com/*` tab inside its non-focused Execution
Window and resolves it from the bound Conversation ID/URL; it never uses the
user's foreground tab as an execution target. DOM discovery and mutation
remain outside the Background.
The Content Script uses separate textarea/contenteditable editor paths, waits
for the Send control to become enabled, and confirms a new user message
containing the current Handoff identifiers before returning `sent`.
Unknown messages are rejected and the Extension has no arbitrary workflow,
MCP, filesystem, or process command surface. Phase 4's `generate` and
`complete` actions are accepted only after Desktop-side correlation and strict
validation. CORS reflects only an
explicit `chrome-extension://`, `extension://`, or `edge-extension://` Origin
and never emits wildcard CORS. The Service Worker path also uses an explicit
`X-Connector-Client` header so it does not depend on Origin being present on
extension Fetch.

The Extension indicator is displayed as a fifth fact in the existing
`SYSTEM CONNECTION` header; pairing details are shown only while pairing is
required. The existing Connector, MCP, ComfyUI, and GPU indicators and the
Creation Pipeline connection gate remain independent. After a valid assistant
Response, Desktop reuses the strict Core parser and existing Apply/Generate
workflow: `generate` automatically applies slots, ensures ComfyUI READY,
runs one Connector-owned Job, and updates OUTPUT/HISTORY; `complete` uses the
existing successful-output and review guard. `GENERATE` exposes only a
user-facing internal substate (ready, starting, waiting, generating, failed),
not a new permanent pipeline stage. The manual Command controls remain
available for recovery and explicit user operation. The complete
endpoint/message/install contract is in
`docs/browser-extension-bridge.md`.

### ChatGPT Context Sync

The Desktop `CHAT` / ChatGPT Context selectors use the authenticated Browser
Extension as a metadata-only discovery provider when the default provider is
used. The Content Script reads visible ChatGPT sidebar metadata and the
current SPA URL; it does not copy conversation bodies and does not call an
undocumented ChatGPT API. Project entries can be route-bearing links or
expandable/button rows (often with a nested `data-marquee-text` title), while
conversation entries can be links or ID-bearing metadata nodes. The locator
chooses the visible sidebar shell containing the complete Project catalog and
does not let a nested Chat-only scrollport hide the Project list. A
conversation `aria-label` can contain Project/Pinned descriptions, so title
extraction prefers the visible title child and only uses a bounded text
fallback. Project routes are identified from stable `g-p-*` routes such as
`/g/g-p-...` and `/g/g-p-.../project`, while conversations are keyed by their
`/c/{conversationId}` identity. A conversation outside a Project is grouped
under `Projectなし`, and `＋ 新しいChat` represents a new-chat target whose
conversation ID is not known until the first Handoff is accepted.

The list request uses a locator-owned Collector discovery helper. Project
discovery reuses the previously successful metadata-only route exactly once
per refresh generation: the first known ChatGPT history sidebar, its visible
`[role="button"][data-sidebar-item="true"]` rows, Project-home anchors, and
one bounded sidebar scroll container. It may expand only a dedicated
`さらに表示`/`もっと見る` utility button; it never opens a generic row to infer
an ID, so navigation items such as `/schedule` and `/plugins` cannot become
Project targets. After root navigation, a separate bounded hydration phase
requires the root URL, complete document state, visible Sidebar shell, and
scroll container to remain structurally stable through a quiet DOM interval;
Content Script ready alone does not start discovery. Readiness and hydration
do not scroll or collect rows. The root scan freezes its
Sidebar and scroll container, moves only downward, restores once, and passes
the resulting Project catalog to stable-identity resolution. For current
ChatGPT disclosure rows, resolution reads the `aria-controls` region and its
Project-scoped `/g/g-p-.../c/...` metadata, expanding that already-discovered
Project row at most once when the region is not yet rendered; it does not
interpret the row click as Project navigation. Root refresh completes after all
Project identities and Projectless Chats are validated; it does not visit
Project pages or require Project-page Chat collection. When a Project is
selected, the same active Collector Tab visits only its canonical Project URL,
verifies that route, and scans that page's Chat container with bounded
incremental scrolling until no new Conversation IDs appear. Project-page
collection does not apply Root `sidebar_scroll_complete` or Project-section
validation, and its failure remains local to the selected Project as
`context_project_chats_incomplete`. Project and Conversation metadata are
merged by ID; a stale result from an earlier Project selection cannot replace a
later selection.

`chatgpt.context.list.request` and
`chatgpt.context.current.request` travel over the existing authenticated
WebSocket and return only bounded Project/Conversation metadata. A list refresh
returns the Project catalog and Projectless Chats; a list request carrying a
validated `collection: "project"` target returns Chats for that one Project.
The complete root result is persisted as a metadata-only local cache; Desktop
can show that snapshot immediately at startup and replace it only when the
newest Collector refresh completes. Collector refresh and Project-selection
generations discard stale results, while the Execution Window and its Managed
Tab remain untouched. The
Content Script also emits a deduplicated `chatgpt.context.changed` event for
SPA navigation and visible link changes. Desktop keeps Loading, Loaded,
Empty, Disconnected, and Error states distinct; refresh preserves stable
selection keys when they still exist. The selected external Project and
Conversation URLs/IDs are copied into the `CreationSession` binding at start.

After a Session starts, selector changes affect only the next draft and never
retarget its Handoff, media attachment, Review, or Resume. The Background
routes an existing bound conversation by conversation ID/URL through the active
Managed ChatGPT Tab in its Execution Window. If the tab or window must be
recovered, it recreates the connector-owned execution media and opens only the
exact saved conversation URL; it never searches for or borrows the user's
foreground tab. A new-chat target uses the managed project/root URL until
ChatGPT creates its conversation URL, which is then returned in the sent
result and persisted by Desktop. The Bridge validates all returned IDs and
ChatGPT URLs; no credentials, tokens, body text, or arbitrary navigation
commands are included in the context protocol.

## UI direction

Creative intensity is concentrated in the production surface: session idea, workflow identity, iteration history, and output handoff. Setup, workflow safety, slot validation, restore, cancellation, and errors keep familiar productive conventions and explicit labels. No particular palette, glow, pulse interval, or animation is a protocol requirement.

## Verification anchors

- `src/ChatGPTComfyConnector.Core/Services/CreationPipelineStateMachine.cs`
  — stage ordering, MCP/ComfyUI connection gate, execution guards, iteration safety
  stop, Review/complete rules, and persisted-session resume semantics.
- `src/ChatGPTComfyConnector.Core/Services/ProtocolAndContext.cs` and
  `docs/connector-protocol-v1.md` — Bootstrap / Result Context, optional kickoff
  instruction, and command contract.
- `src/ChatGPTComfyConnector.Infrastructure/Workflows/WorkflowCatalog.cs` and
  `src/ChatGPTComfyConnector.Infrastructure/Storage/PortableStore.cs` — dynamic
  slots, backup/rollback, output fetching, and atomic Portable persistence.
- `src/ChatGPTComfyConnector.Infrastructure/Bridge/BrowserExtensionBridge.cs`,
  `src/ChatGPTComfyConnector.Infrastructure/Storage/PortableStore.cs`, and
  `docs/browser-extension-bridge.md` — local Extension transport,
  pairing/bootstrap authentication, Handoff delivery envelope, persistence,
  Managed-Tab routing, Conversation identity, and lifecycle.
- `tests/ChatGPTComfyConnector.Tests/CreationPipelineStateMachineTests.cs`,
  `CreationPreparationTests.cs`, `ProtocolTests.cs`, and `SessionAndStorageTests.cs`
  — preparation isolation, state, protocol, provider, persistence, and legacy
  pipeline compatibility behavior.
- `tests/ChatGPTComfyConnector.Tests/BrowserExtensionBridgeTests.cs` — loopback
  health without token disclosure, pairing/bootstrap, persistence, Origin/CORS,
  process-token rotation, WebSocket, ping/pong, event, and disconnect behavior.
