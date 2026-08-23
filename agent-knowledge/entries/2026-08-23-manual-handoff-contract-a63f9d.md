---
id: rm-20260823-manual-handoff-contract
topic: manual-handoff
type: decision
status: active
maturity: candidate
created: 2026-08-23
last_verified: 2026-08-23
source_commit: "4b7976c"
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
supersedes: null
promoted_to: null
---
# v0.1のChatGPT連携はManual Handoffである

## Conclusion

v0.1はChatGPTへの自動送信を行わず、ConnectorがBootstrap Context / Result Contextをclipboardへ作成し、ユーザーが通常のChatGPTへ貼り付ける。ChatGPTの応答は `comfy-connector/1` の単一JSON commandとしてConnectorへ貼り付け、`IMPORT / VALIDATE` 後にユーザーが `APPLY` または `APPLY + GENERATE` を明示的に実行する。

Protocolのactionは高レベルな `generate` と `complete` だけである。Handoff履歴は `CONNECTOR → CHATGPT`、`CHATGPT → COMFY`、`COMFY → CHATGPT` の3方向を使い、方向と独立した `HandoffMessageKind` で制作リクエスト、生成指示、生成結果、完了指示などを分類する。カードは `DisplayText` を主表示、`Metadata` を補助情報、`Payload` を全文コピー用として分離する。表示を短縮してもcopy操作は常に全文Payloadを使う。

`Summary` は旧Session JSONとの互換fallbackとして残し、読み込み時のnormalizationで古い方向・kind・本文・metadataを現行表示へ補正する。

## Scope

Applicable:
- BootstrapのChatGPT handoff、Command import / validation / apply、Result Contextのレビュー返却、Handoff Timeline表示。
- 将来の自動Providerを追加する際に、v0.1のclipboard境界と現行Persisted JSONを壊さない移行設計。

Do not apply:
- v0.1でChatGPT API、Browser操作、添付ファイルの自動送信を実装済みとは扱わない。
- Commandの全文を表示用の短い本文へ置き換えたり、raw payloadへshellや任意pathの権限を与えたりしない。

## Evidence

- `ConnectorProtocol.Parse` / `ValidateAgainstSlots` と `docs/connector-protocol-v1.md` がaction、fence、protocol、slot、pathの境界を定義する。
- `ConnectorContextBuilder.BuildBootstrap` / `BuildResult` がmanual clipboard用Contextを構築する。
- `HandoffMessage`、`HandoffTimelineItem`、`MainViewModel.RecordHandoffAsync` が方向、kind、表示本文、metadata、全文Payload、legacy Summaryの責務を分ける。
- `ProtocolTests` はraw/fenced command、拒否条件、slot検証を確認し、`SessionAndStorageTests.LocalChatContextsAndHandoffTimelineRoundTrip` はHandoff履歴の永続化を確認する。

## Verification

1. Protocol変更時は `docs/connector-protocol-v1.md` と `ConnectorProtocol` の許可action／拒否条件を同期する。
2. Timeline変更時は3方向、kind、本文省略、全文copy、legacy normalizationを確認する。
3. `ProtocolTests`、`SessionAndStorageTests`、必要なdesktop buildを実行する。
