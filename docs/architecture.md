# Architecture

## Boundaries

```text
WPF Desktop
  ├─ MainViewModel: user flow, dirty/session/job presentation
  ├─ Core: domain models, path safety, Protocol v1, context builders
  └─ Infrastructure
       ├─ PortableStore: atomic settings/session JSON, logs, backups
       ├─ WorkflowCatalog: filesystem tree + dynamic MCP slot/job mapping
       ├─ ComfyMcpClient: official C# SDK StdioClientTransport
       └─ ComfyUiEndpointHealthProbe: direct ComfyUI HTTP runtime check
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
  → fetch_outputs
  → Session Iteration persistence
```

If slot application or validation fails, the pre-save backup is restored. Backup retention is three JSON generations per logical Workflow. Restore itself first creates a backup of the current file.

## Creation Session and pipeline

`CreationSession` is the durable unit of a production. It binds the GUI-selected
`WorkflowIdentity`, a provider-neutral Project / Chat reference, the original idea,
iteration history, Handoff messages, and the current pipeline snapshot. Sessions are
stored as JSON files below `data/sessions/`; rebuilding the application does not clear
this history.

The pipeline is an ordered state machine:

```text
Connect → Context → Idea → ToChatGpt → Command → Apply → Generate → Output → Review
```

Connect is the first production gate, not a duplicate of the header telemetry. It is
completed when the MCP transport is connected; ComfyUI running state is deliberately not
part of this gate. Connecting uses `InProgress`; a mid-session MCP disconnect uses
`WaitingUser`; transport failure uses `Error`. Context can become current while ComfyUI
is stopped. Workflow-specific slot discovery remains a Context responsibility.

Context binding requires a Workflow whose slot schema loaded successfully, Project,
Chat, a positive maximum-iteration limit, and successful Session creation/binding. The
idea must be explicitly copied to ChatGPT before a command can be
validated. A validated `generate` command enters Apply, where slot changes are
backed up, written, saved, and validated before Generate is enabled. A completed Job
must produce at least one existing output before Review becomes available. `complete`
is accepted only from a Review state after a successful output; it preserves all
iterations and outputs. Reaching the iteration limit creates an explicit user
decision stop rather than silently starting another iteration.

The initial `SEND TO CHATGPT` action is governed by the Core
`CreationWorkspacePolicy` and is exposed by the ViewModel as
`CanSendToChatGpt`. It requires an explicitly activated, Context-bound session,
loaded slot schema, connected MCP, a non-empty idea, an IDEA stage that is still
current (or waiting for user input), and no active Job. ComfyUI runtime readiness
is intentionally excluded because the initial handoff does not execute a
ComfyUI-dependent operation.

At startup, persisted sessions are loaded only as internal data for provider
bindings and future recovery. They are not expanded into the visible Workspace:
the current session is a fresh, non-persisted draft with an empty idea, command,
handoff timeline, output, and iteration history, and the pipeline starts at
Connect. `StartNewCreationAsync` is the explicit activation boundary: it creates
and persists a new session only after the MCP, Workflow/slot schema, Project,
Chat, and maximum-iteration prerequisites pass. `ResumeSessionAsync` remains the
explicit reactivation path for an already active session and is not an automatic
startup recovery mechanism.

Connection loss never resets the Session, Workflow selection, Project / Chat, original
idea, iterations, or outputs. It moves Connect back to `WaitingUser` or `Error` and
blocks connection-dependent Apply/Generate operations. A successful reconnect completes
the same gate and resumes the existing Session from its retained production stage.

`WaitingUser` is a shared state, while `CreationStageStatus.WaitingReason` carries the
specific reason. The Core projection resolves that pair into concise UI text: a
ComfyUI-dependent stage uses `ComfyUI起動待ち`, a disconnected MCP gate uses `再接続待ち`,
ToChatGpt uses `ChatGPT返答待ち`, Review uses `レビュー返答待ち`, and the iteration
safety stop uses `続行判断待ち`. The UI must not display the enum name or a generic
`ユーザー待ち` label.

The small helper text at the top-right of the Creation Pipeline is resolved by
CreationPipelineLoopText. It selects the most recently updated active stage in
the ordered Core state machine and combines that stage with its state, the
current idea input, or a structured waiting reason. This keeps messages such as
"IDEA → 制作アイデアを入力", "GENERATE → 生成中", and
"REVIEW → レビュー返答待ち" aligned with the actual pipeline state instead
of using the broad Active session status as a shortcut.

ComfyUI readiness is checked immediately before operations that need it, through
`CreationPipelineStateMachine.RequireComfyUi`. If the running check is false, only that
stage becomes `WaitingUser`; Context, Idea, and Manual Handoff remain usable while the
user starts ComfyUI. CONNECT itself is never downgraded merely because ComfyUI is stopped.

The Desktop header owns one independent `ComfyUiRuntimeState` and refreshes it with a
lightweight direct HTTP health check against `AppSettings.Endpoint` (`/system_stats`).
This check runs whether MCP is connected or disconnected, so `MCP未接続 · ComfyUI READY`
is represented without conflating the two facts. `START COMFYUI` sets `STARTING`
immediately; an unavailable endpoint keeps that state while the periodic probe retries,
and a successful response changes it to `READY`. Normal unavailable probes resolve to
`STOPPED`, launch/probe configuration failures to `ERROR`, and `server_info` remains
available only for optional MCP-provided details such as GPU information. Generate
retains its immediate direct preflight as the final ComfyUI gate.

## Manual Handoff and timeline

v0.1 uses a manual clipboard transport: Connector creates a self-contained Bootstrap
/ Review Handoff, the user pastes it into ChatGPT, and ChatGPT's validated
`comfy-connector/1` Connector Response is pasted back into the Connector. A Response
contains exactly one small `connector-command` JSON block and zero or more referenced
raw `COMFY_PAYLOAD` blocks. Connector-generated `handoff_id`, `session_id`, and
`boundary_id` bind the response to a persisted Pending Handoff snapshot containing
AllowedActions, Workflow identity, Iteration, and the MCP-discovered slot schema plus
its ChatGPT exposure policy.
Validation therefore does not trust stale clipboard text or transient UI state.

Free-form string slots use payload references; numeric, boolean, and choice values
remain direct JSON, but transport capability does not imply ChatGPT writability.
`ChatGptSlotPolicy` exposes only recognized creative controls, hides filesystem,
model, and internal-expression settings, defaults unknown slots to Hidden, and makes
enum/dynamic-combo slots ReadOnly when allowed choices are unavailable. The Pending
Handoff snapshot—not the current editor state—is the validation source of truth.
Slot discovery distinguishes NotLoaded, Loading, Loaded, and
Failed, so an unavailable schema is never silently exported as an empty slot list.
The detailed grammar and validation invariants are canonicalized in
`docs/connector-protocol-v1.md`. Clipboard is only the current transport boundary;
the Protocol and Pending Handoff models remain reusable by a future browser or
external provider.

The persisted
`HandoffMessage` separates transport direction, message kind, display text, secondary
metadata, and the full payload. The three semantic directions are
`CONNECTOR → CHATGPT`, `CHATGPT → COMFY`, and `COMFY → CHATGPT`; the initial creation
bootstrap is Connector → ChatGPT, not a Comfy result. Timeline cards may shorten only
the visible display text, while copy actions continue to use the full payload.

The older `Summary` field remains a compatibility fallback for sessions written
before the content-first card model. Existing messages are normalized when loaded so
legacy direction, kind, display text, and metadata do not break the timeline.

## Production UI information architecture

Timeline Copy is a pure re-copy operation: when a card has a persisted
Payload, the Desktop ViewModel returns that exact string without creating a new
handoff, rotating PendingHandoff, validating the current IDEA stage, or
changing the pipeline. Result Handoff copying follows the same reuse rule;
payload generation is only a fallback for an iteration whose saved Handoff
payload is absent.

The desktop surface keeps three responsibilities distinct:

- left: Workflow library, selection, duplicate/rename, and the detailed Workflow
  editor entry;
- center: Creation Pipeline, idea input, current output preview, generation status,
  and iteration history;
- right: Handoff Timeline, ChatGPT command import/validation/apply, and Session
  resume controls.

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

## UI direction

Creative intensity is concentrated in the production surface: session idea, workflow identity, iteration history, and output handoff. Setup, workflow safety, slot validation, restore, cancellation, and errors keep familiar productive conventions and explicit labels. No particular palette, glow, pulse interval, or animation is a protocol requirement.

## Verification anchors

- `src/ChatGPTComfyConnector.Core/Services/CreationPipelineStateMachine.cs`
  — stage ordering, MCP/ComfyUI connection gate, execution guards, iteration safety
  stop, Review/complete rules, and persisted-session resume semantics.
- `src/ChatGPTComfyConnector.Core/Services/ProtocolAndContext.cs` and
  `docs/connector-protocol-v1.md` — Bootstrap / Result Context and command contract.
- `src/ChatGPTComfyConnector.Infrastructure/Workflows/WorkflowCatalog.cs` and
  `src/ChatGPTComfyConnector.Infrastructure/Storage/PortableStore.cs` — dynamic
  slots, backup/rollback, output fetching, and atomic Portable persistence.
- `tests/ChatGPTComfyConnector.Tests/CreationPipelineStateMachineTests.cs`,
  `ProtocolTests.cs`, and `SessionAndStorageTests.cs` — state, protocol, provider,
  persistence, and compatibility behavior.
