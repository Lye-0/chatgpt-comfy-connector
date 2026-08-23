# Architecture

## Boundaries

```text
WPF Desktop
  ├─ MainViewModel: user flow, dirty/session/job presentation
  ├─ Core: domain models, path safety, Protocol v1, context builders
  └─ Infrastructure
       ├─ PortableStore: atomic settings/session JSON, logs, backups
       ├─ WorkflowCatalog: filesystem tree + dynamic MCP slot/job mapping
       └─ ComfyMcpClient: official C# SDK StdioClientTransport
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
Context → Idea → ToChatGpt → Command → Apply → Generate → Output → Review
```

Context binding requires a Workflow, Project, Chat, and a positive maximum-iteration
limit. The idea must be explicitly copied to ChatGPT before a command can be
validated. A validated `generate` command enters Apply, where slot changes are
backed up, written, saved, and validated before Generate is enabled. A completed Job
must produce at least one existing output before Review becomes available. `complete`
is accepted only from a Review state after a successful output; it preserves all
iterations and outputs. Reaching the iteration limit creates an explicit user
decision stop rather than silently starting another iteration.

Loading a persisted session restores its history but does not implicitly activate it
as a new creation. `StartNewCreationAsync` creates a new session and binds its
context; `ResumeSessionAsync` explicitly reactivates a completed, paused, stopped,
or errored session without deleting its previous iterations.

## Manual Handoff and timeline

v0.1 uses a manual clipboard boundary: Connector creates Bootstrap / Result Context
text, the user pastes it into ChatGPT, and ChatGPT's single validated
`comfy-connector/1` command is pasted back into the Connector. The persisted
`HandoffMessage` separates transport direction, message kind, display text, secondary
metadata, and the full payload. The three semantic directions are
`CONNECTOR → CHATGPT`, `CHATGPT → COMFY`, and `COMFY → CHATGPT`; the initial creation
bootstrap is Connector → ChatGPT, not a Comfy result. Timeline cards may shorten only
the visible display text, while copy actions continue to use the full payload.

The older `Summary` field remains a compatibility fallback for sessions written
before the content-first card model. Existing messages are normalized when loaded so
legacy direction, kind, display text, and metadata do not break the timeline.

## Production UI information architecture

The desktop surface keeps three responsibilities distinct:

- left: Workflow library, selection, duplicate/rename, and the detailed Workflow
  editor entry;
- center: Creation Pipeline, idea input, current output preview, generation status,
  and iteration history;
- right: Handoff Timeline, ChatGPT command import/validation/apply, and Session
  resume controls.

The header's `Connector → MCP → ComfyUI → GPU` indicators describe system
connectivity, not the creation pipeline. Workflow slots remain dynamically loaded
and are edited in the dedicated Workflow settings view rather than making the
creation canvas a low-level slot editor. Connection state and production state must
therefore remain separate visual and behavioral concerns.

## Process lifecycle

`ComfyMcpClient` starts the configured `comfy-mcp.exe` using `StdioClientTransport` with a minimal environment plus `COMFY_BIN`, `COMFY_PROJECT`, and `COMFYUI_URL`. The current runtime's initialize-capable MCP revision (`2025-06-18`) is requested explicitly. Standard error is captured into the Portable log; if the transport closes unexpectedly, the SDK's process ID, exit code, and stderr tail are recorded as one diagnostic entry. Connector shutdown disposes the MCP client and child process; it never stops ComfyUI.

The app does not call ComfyUI management tools such as model download, node installation, update, or version switching.

## UI direction

Creative intensity is concentrated in the production surface: session idea, workflow identity, iteration history, and output handoff. Setup, workflow safety, slot validation, restore, cancellation, and errors keep familiar productive conventions and explicit labels. No particular palette, glow, pulse interval, or animation is a protocol requirement.

## Verification anchors

- `src/ChatGPTComfyConnector.Core/Services/CreationPipelineStateMachine.cs`
  — stage ordering, gating, iteration safety stop, Review/complete rules, and
  persisted-session resume semantics.
- `src/ChatGPTComfyConnector.Core/Services/ProtocolAndContext.cs` and
  `docs/connector-protocol-v1.md` — Bootstrap / Result Context and command contract.
- `src/ChatGPTComfyConnector.Infrastructure/Workflows/WorkflowCatalog.cs` and
  `src/ChatGPTComfyConnector.Infrastructure/Storage/PortableStore.cs` — dynamic
  slots, backup/rollback, output fetching, and atomic Portable persistence.
- `tests/ChatGPTComfyConnector.Tests/CreationPipelineStateMachineTests.cs`,
  `ProtocolTests.cs`, and `SessionAndStorageTests.cs` — state, protocol, provider,
  persistence, and compatibility behavior.
