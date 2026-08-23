---
id: rm-20260823-provider-neutral-context
topic: project-chat-provider
type: decision
status: active
maturity: candidate
created: 2026-08-23
last_verified: 2026-08-23
source_commit: "4b7976c"
related_files:
  - docs/architecture.md
  - src/ChatGPTComfyConnector.Core/Services/Contracts.cs
  - src/ChatGPTComfyConnector.Core/Models/AppModels.cs
  - src/ChatGPTComfyConnector.Infrastructure/Contexts/LocalProjectChatProvider.cs
  - src/ChatGPTComfyConnector.Desktop/ViewModels/MainViewModel.cs
  - tests/ChatGPTComfyConnector.Tests/SessionAndStorageTests.cs
tags:
  - provider
  - project
  - chat
  - context-binding
  - compatibility
supersedes: null
promoted_to: null
---
# Project / ChatはProvider境界で扱う

## Conclusion

ProjectとChatの選択UIおよびSession bindingは、ローカルJSONの保存形式ではなく `IProjectChatProvider` と `ProjectChatCatalog` の契約に依存する。現在の `LocalProjectChatProvider` は `chatgpt-contexts.json` を使う1実装にすぎず、将来のBrowser ExtensionやHandoff ProviderをUIやSessionモデルの変更なしに差し替えられる構造を維持する。

Sessionの正規参照は `ContextProviderId`、`ProjectContextKey`、`ChatContextKey`、表示用のProjectLabel / ChatLabelである。旧 `LocalProjectContextId` と `LocalChatContextId` は既存JSON互換のfallbackとして残し、新しい外部Providerの識別子に置き換えない。

## Scope

Applicable:
- Project / Chatの一覧、作成、選択、Sessionへのbinding、将来Provider追加。
- Local JSONから外部Providerへ移行・併用する場合のモデル設計。

Do not apply:
- UIやSessionへ `LocalContextCatalog` の内部ID・ファイルパスを直接埋め込まない。
- ProviderのExternalIdや実ChatGPT Conversation IDを、v0.1の自動通信が存在するかのように扱わない。

## Evidence

- `IProjectChatProvider` は `ProviderId`、`LoadAsync`、`CreateProjectAsync`、`CreateChatAsync` のみをUI境界へ公開する。
- `CreationSession.ToProjectChatBindingSnapshot` はProvider ID、Project / Chat key、表示ラベル、外部IDをProvider-neutralに返す。
- `LocalProjectChatProvider` はlocal JSONを読み書きしつつ、既存Session bindingから不足するProject / Chatを復元する。
- `SessionAndStorageTests.LocalJsonProviderExposesProviderNeutralProjectAndChatOptions` と `SessionBindingSupportsNonLocalProviderReferences` がlocal実装と非local参照の両方を検証する。

## Verification

1. Provider追加・変更時は `IProjectChatProvider` と `CreationSession` の正規キーが保たれているか確認する。
2. Local JSONを直接参照するUIコードが増えていないか検索する。
3. `SessionAndStorageTests` を実行し、local catalogの互換fallbackと非local Provider IDのbindingを確認する。
