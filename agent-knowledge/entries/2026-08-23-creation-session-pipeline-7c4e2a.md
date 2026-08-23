---
id: rm-20260823-creation-session-pipeline
topic: creation-session
type: constraint
status: active
maturity: candidate
created: 2026-08-23
last_verified: 2026-08-23
source_commit: "4b7976c"
related_files:
  - docs/architecture.md
  - src/ChatGPTComfyConnector.Core/Models/AppModels.cs
  - src/ChatGPTComfyConnector.Core/Services/CreationPipelineStateMachine.cs
  - src/ChatGPTComfyConnector.Desktop/ViewModels/MainViewModel.cs
  - tests/ChatGPTComfyConnector.Tests/CreationPipelineStateMachineTests.cs
tags:
  - session
  - pipeline
  - iteration
  - review
  - persistence
supersedes: null
promoted_to: null
---
# Creation Sessionは履歴を保持する制作単位である

## Conclusion

`CreationSession` はWorkflow、Project / Chat、制作アイデア、Iteration、Output、Handoff、Pipeline状態をまとめて保持する永続的な制作単位である。Pipelineの正規順序は `Context → Idea → ToChatGpt → Command → Apply → Generate → Output → Review` で、後段の操作は前段の条件を満たした場合だけ許可する。

Context bindingにはWorkflow、Project、Chat、1以上のMaximum Iterationsが必要。制作アイデアはChatGPTへBootstrapを渡して初めて確定し、Commandを検証できる。`generate` は Apply（backup、slot反映、保存、validate）後にのみ実行できる。Job完了後は存在するOutputが1件以上ある場合だけReviewへ進み、`complete` は成功Output後のReviewでのみ受理する。Iteration上限到達時は自動継続せず、ユーザー判断用のSafety Stopを設ける。

## Scope

Applicable:
- Session lifecycle、Iteration、Manual Handoff、生成開始／完了／失敗／キャンセルの状態遷移。
- 新しい制作を開始する操作、保存済みSessionのResume、既存履歴を保ったままのContext再bind。

Do not apply:
- ComfyUI自体のJob内部状態をこのState Machineだけで推測しない。
- ビルドやアプリ再起動をSession初期化とみなさない。保存済み履歴は明示的な新規制作まで保持する。

## Evidence

- `CreationPipelineStateMachine.OrderedStages` と `BindContext`、`BootstrapCopied`、`CommandValidated`、`OutputCompleted`、`Complete`、`ContinueBeyondLimit`。
- `MainViewModel.InitializeAsync` は保存済みSessionを読み込むが `_isCurrentSessionActivated` を false にし、`StartNewCreationAsync` / `ResumeSessionAsync` で明示的に有効化する。
- `CreationPipelineStateMachineTests` は正常完了、Reviewからの次Iteration、Command／Apply／Job／Output失敗、編集後の下流リセット、上限停止、Context再bindを検証する。

## Verification

1. `CreationPipelineStateMachine.OrderedStages` と各遷移メソッドを現在コードで再確認する。
2. `dotnet test tests/ChatGPTComfyConnector.Tests/ChatGPTComfyConnector.Tests.csproj -c Release` を実行し、Pipelineテストを確認する。
3. Session persistenceを変更する場合は `PortableStore` と `SessionAndStorageTests` も併せて確認する。
