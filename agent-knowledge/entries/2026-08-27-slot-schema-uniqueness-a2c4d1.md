---
id: rm-20260827-slot-schema-uniqueness
topic: workflow-slot-safety
type: pattern
status: active
maturity: candidate
created: 2026-08-27
last_verified: 2026-08-27
source_commit: null
related_files:
  - src/ChatGPTComfyConnector.Core/Services/SlotSchemaPolicy.cs
  - src/ChatGPTComfyConnector.Infrastructure/Workflows/WorkflowCatalog.cs
  - src/ChatGPTComfyConnector.Core/Services/ProtocolAndContext.cs
  - src/ChatGPTComfyConnector.Desktop/ViewModels/MainViewModel.cs
  - tests/ChatGPTComfyConnector.Tests/ProtocolTests.cs
  - tests/ChatGPTComfyConnector.Tests/WorkflowCatalogTests.cs
tags:
  - workflow
  - slots
  - schema
  - duplicate
  - validation
  - async-race
supersedes: null
promoted_to: null
---
# Workflow Slot Schemaの一意性と非同期発見結果の境界

## Conclusion

Workflow slotのProtocol identityはAddressであり、全層で `StringComparer.OrdinalIgnoreCase` を使う。MCP発見結果はEditorへ渡す前に正規化し、同一schemaの重複は1件へ畳み、同じAddressでschema内容が異なる場合はconflictとして拒否する。Pending Handoffのsnapshot生成にも同じ規則を適用する。永続化されたsnapshotに重複が残っていた場合、Parserは辞書化例外を起こさず、通常のProtocol validation errorとしてCommandをrejectする。Workflow選択や再接続で並行するslot取得は読み込み世代で管理し、古い応答を現在のcollectionへ追加しない。

## Scope

Applicable:
- `list_workflow_slots` の結果、Workflow editor collection、Pending Handoff、Handoff本文、Connector Response validation。
- Workflow選択とMCP再接続が重なるDesktop lifecycle。

Do not apply:
- duplicateを表示時だけ隠して、Pending Handoffやvalidationのschemaを曖昧にする実装。
- 同じAddressの異なるschemaを後勝ちで上書きする実装。

## Evidence

- `SlotSchemaPolicy` が発見slotとPending snapshotの正規化、競合検出、safe dictionary構築を一元化する。
- `WorkflowCatalog.DiscoverSlotsAsync` と `MainViewModel.SelectWorkflowAsync` がEditorへ入る前の一意性・読み込み世代境界を適用する。
- `ConnectorProtocol.Parse` は `generate` と `complete` の両方で重複snapshotをvalidation errorへ変換する。
- `dotnet test -c Release --no-restore` は98件すべて合格し、H3のシンプル構成／MCPテストWorkflowの実slot取得は各26件・重複なしだった。

## Verification

1. `SlotSchemaPolicy` のAddress comparerとconflict判定を確認する。
2. Catalog、PendingHandoffFactory、Protocol Parserを通した重複／競合テストを実行する。
3. Workflow再選択・再接続の並行slot取得で、古い応答が現在のcollectionへ追加されないことを確認する。
