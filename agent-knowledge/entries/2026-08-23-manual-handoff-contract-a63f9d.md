---
id: rm-20260823-manual-handoff-contract
topic: manual-handoff
type: decision
status: active
maturity: reused
created: 2026-08-23
last_verified: 2026-08-23
source_commit: "cdbe45a"
related_files:
  - README.md
  - docs/architecture.md
  - docs/connector-protocol-v1.md
  - src/ChatGPTComfyConnector.Core/Models/AppModels.cs
  - src/ChatGPTComfyConnector.Core/Services/ProtocolAndContext.cs
  - src/ChatGPTComfyConnector.Desktop/ViewModels/HandoffTimelineItem.cs
  - src/ChatGPTComfyConnector.Desktop/ViewModels/MainViewModel.cs
  - src/ChatGPTComfyConnector.Desktop/MainWindow.xaml
  - tests/ChatGPTComfyConnector.Tests/ProtocolTests.cs
  - tests/ChatGPTComfyConnector.Tests/SessionAndStorageTests.cs
tags:
  - handoff
  - clipboard
  - protocol
  - timeline
  - content-first
  - raw-payload
  - pending-handoff
supersedes: null
promoted_to: null
---
# v0.1のChatGPT連携はManual Handoffである

## Conclusion

v0.1はChatGPTへの自動送信を行わず、Connectorが自己完結したBootstrap / Review Handoffをclipboardへ作成し、ユーザーが通常のChatGPTへ貼り付ける。ChatGPTの応答は `comfy-connector/1` Connector ResponseとしてConnectorへ貼り付け、`IMPORT / VALIDATE` 後にユーザーが `APPLY` または `APPLY + GENERATE` を明示的に実行する。

Connector Responseは正確に1つの小さな `connector-command` JSON blockと、0件以上の参照されたRaw `COMFY_PAYLOAD` blockから成る。自由入力stringはpayload reference、number / boolean / choiceはdirect JSONを使う。ConnectorがHandoffごとに `handoff_id` と `boundary_id` を生成し、Creation Sessionの `session_id` と共に完全一致で検証する。Pending HandoffはAllowedActions、Workflow identity、Iteration、MCP取得時点のslot schemaを永続化し、stale応答、未知slot、型・choice・range違反、変更されていないslot、missing / duplicate / wrong-boundary payloadをAPPLY前に拒否する。

Slot discoveryは `NotLoaded` / `Loading` / `Loaded` / `Failed` を区別し、MCP未接続や取得失敗を正常な空schemaとしてChatGPTへ渡さない。初回Handoffは `generate`、成功Output後のReview Handoffは `generate, complete` を許可し、`complete` の最終可否は既存Creation State Machineが決める。Clipboardは現在のTransportに過ぎず、Protocol / Pending Handoff modelは将来のBrowser Extension等から再利用可能な境界とする。

Protocolのactionは高レベルな `generate` と `complete` だけである。Handoff履歴は `CONNECTOR → CHATGPT`、`CHATGPT → COMFY`、`COMFY → CHATGPT` の3方向を使い、方向と独立した `HandoffMessageKind` で制作リクエスト、生成指示、生成結果、完了指示などを分類する。カードは `DisplayText` を主表示、`Metadata` を補助情報、`Payload` を全文コピー用として分離する。表示を短縮してもcopy操作は常に全文Payloadを使う。

`Summary` は旧Session JSONとの互換fallbackとして残し、読み込み時のnormalizationで古い方向・kind・本文・metadataを現行表示へ補正する。Raw ResponseはTimelineの表示用本文から分離して保持し、copyではconnector-commandと全Payloadを含む全文を返す。

## Scope

Applicable:
- Bootstrap / Reviewの自己完結Handoff、Connector Response import / validation / apply、Handoff Timeline表示。
- 将来の自動Providerを追加する際に、v0.1のclipboard境界と現行Persisted JSONを壊さない移行設計。

Do not apply:
- v0.1でChatGPT API、Browser操作、添付ファイルの自動送信を実装済みとは扱わない。
- Response全文を表示用の短い本文へ置き換えたり、raw payloadへshell、filesystem、MCP tool callの権限を与えたりしない。

## Evidence

- `ConnectorProtocol.Parse` と `docs/connector-protocol-v1.md` がenvelope、IDs、payload、action、slot transport、changed-onlyの境界を定義する。
- `PendingHandoffFactory`、`ConnectorContextBuilder.BuildBootstrap` / `BuildResult` がsnapshotと自己完結Contextを構築する。
- `HandoffMessage`、`HandoffTimelineItem`、`MainViewModel.RecordHandoffAsync` が方向、kind、表示本文、metadata、全文Payload、legacy Summaryの責務を分ける。
- `ProtocolTests` は20KB級Raw text、特殊文字、複数payload、boundary / identity / slot / action拒否と自己完結Contextを確認し、`SessionAndStorageTests.LocalChatContextsAndHandoffTimelineRoundTrip` はPending Handoffを含む永続化を確認する。
- 2026-08-23の実GUI確認では実 `comfy-mcp.exe` stdio接続、Workflow選択、26 slot取得、Session開始とCONTEXT→IDEA遷移を確認した。ComfyUIはSTOPPEDだったためGPU生成は未実施。

## Verification

1. Protocol変更時は `docs/connector-protocol-v1.md`、`ConnectorProtocol`、`PendingHandoffFactory` のgrammar／許可action／拒否条件を同期する。
2. Timeline変更時は3方向、kind、本文省略、全文copy、legacy normalizationを確認する。
3. `ProtocolTests`、`CreationPipelineStateMachineTests`、`SessionAndStorageTests`、desktop buildを実行する。

## Reuse Evidence

- 後続の正式Handoff Protocol実装で、既存Manual Clipboard境界、3方向Timeline、content-first表示、State Machineのcomplete規則を設計の開始点として再利用し、現行コード・34 tests・実MCP接続で再検証した。
