---
id: rm-20260823-creation-session-pipeline
topic: creation-session
type: constraint
status: active
maturity: reused
created: 2026-08-23
last_verified: 2026-08-23
source_commit: "332307c"
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
  - connection-gate
  - reconnect
  - waiting-reason
supersedes: null
promoted_to: null
---
# Creation Sessionは履歴を保持する制作単位である

## Conclusion

`CreationSession` はWorkflow、Project / Chat、制作アイデア、Iteration、Output、Handoff、Pipeline状態をまとめて保持する永続的な制作単位である。Pipelineの正規順序は `Connect → Context → Idea → ToChatGpt → Command → Apply → Generate → Output → Review` で、後段の操作は前段の条件を満たした場合だけ許可する。

ConnectはHeaderの詳細表示とは別の制作Gateであり、MCP接続とComfyUI到達の両方をCoreが確認した場合だけCompletedになる。ボタン押下自体は完了条件ではない。Context bindingにはSlot Schema取得済みWorkflow、Project、Chat、1以上のMaximum Iterations、Session作成／binding成功が必要。制作アイデアはChatGPTへBootstrapを渡して初めて確定し、Commandを検証できる。`generate` は Apply（backup、slot反映、保存、validate）後にのみ実行できる。Job完了後は存在するOutputが1件以上ある場合だけReviewへ進み、`complete` は成功Output後のReviewでのみ受理する。Iteration上限到達時は自動継続せず、ユーザー判断用のSafety Stopを設ける。

制作途中でMCPまたはComfyUIが切断された場合はConnectをWaitingUserまたはErrorへ戻し、接続必須操作だけを止める。Session、Workflow選択、Project / Chat、Original Idea、Iteration／Output履歴は消去しない。再接続後は同じSessionと後段状態を維持して続行する。

`WaitingUser`は共通Stateとして維持し、`CreationStageStatus.WaitingReason`で待機理由を構造化する。Coreの表示解決はStageとReasonを組み合わせ、ConnectはComfyUI起動待ち／再接続待ち、ToChatGptはChatGPT返答待ち、Reviewはレビュー返答待ち、Iteration上限は続行判断待ちと表示する。UIがEnum名や一律のユーザー待ちを直接表示してはいけない。

## Scope

Applicable:
- Session lifecycle、Iteration、Manual Handoff、生成開始／完了／失敗／キャンセルの状態遷移。
- 新しい制作を開始する操作、保存済みSessionのResume、既存履歴を保ったままのContext再bind。
- MCP／ComfyUI readinessを制作Gateへ同期し、切断中だけ接続必須操作をブロックする挙動。

Do not apply:
- ComfyUI自体のJob内部状態をこのState Machineだけで推測しない。
- ビルドやアプリ再起動をSession初期化とみなさない。保存済み履歴は明示的な新規制作まで保持する。

## Evidence

- `CreationPipelineStateMachine.OrderedStages`、`EvaluateConnectionGate`、`SynchronizeConnectionGate`、`RequireConnection`、`GetStageStateLabel` と `BindContext`、`BootstrapCopied`、`CommandValidated`、`OutputCompleted`、`Complete`、`ContinueBeyondLimit`。
- `MainViewModel.InitializeAsync` は保存済みSessionを読み込むが `_isCurrentSessionActivated` を false にし、`StartNewCreationAsync` / `ResumeSessionAsync` で明示的に有効化する。
- `MainViewModel.ConnectAsync` は実際のMCP接続と `server_info.running` を確認し、CoreのGateへ同期する。MCP接続だけでComfyUI停止中ならWaitingUserのままである。
- `CreationPipelineStateMachineTests` は未接続、接続中、ComfyUI待ち、接続失敗、接続完了後のContext、制作途中切断時のデータ保持、再接続継続に加え、既存の正常完了・失敗・上限停止を検証する。
- `CreationPipelineStateMachineTests` はWaitingUserのStage別理由（ComfyUI起動、ChatGPT返答、レビュー返答、続行判断）と表示ラベルを検証する。

## Verification

1. `CreationPipelineStateMachine.OrderedStages` とConnect Gate／各遷移メソッドを現在コードで再確認する。
2. `dotnet test tests/ChatGPTComfyConnector.Tests/ChatGPTComfyConnector.Tests.csproj -c Release` を実行し、Pipelineテストを確認する。
3. Session persistenceを変更する場合は `PortableStore` と `SessionAndStorageTests` も併せて確認する。
4. 実アプリで未接続のCurrent、接続処理中のInProgress、ComfyUI停止時のWaitingUserを確認し、Headerの詳細状態と矛盾しないことを確認する。
