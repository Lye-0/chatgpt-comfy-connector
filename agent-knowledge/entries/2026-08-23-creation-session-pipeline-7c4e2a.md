---
id: rm-20260823-creation-session-pipeline
topic: creation-session
type: constraint
status: active
maturity: reused
created: 2026-08-23
last_verified: 2026-08-26
source_commit: "5c1d16f"
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

`CreationSession` はWorkflow、Project / Chat、制作アイデア、Iteration、Output、Handoff、Pipeline状態をまとめて保持する永続的な制作単位である。Pipelineの正規順序は `Connect → Context → Idea → ToChatGpt → Command → Apply → Generate → Output → Review` で、後段の操作は前段の条件を満たした場合だけ許可する。保存済みSessionは起動時に内部データとして読み込むが、現在のWorkspaceへ自動展開しない。起動時は空の非永続ドラフトを表示し、`StartNewCreationAsync`を明示的なSession有効化境界とする。

ConnectはHeaderの詳細表示とは別の制作Gateであり、MCP接続が成立した場合にCompletedになる。ComfyUI RunningはConnectの完了条件に含めない。Context bindingにはSlot Schema取得済みWorkflow、Project、Chat、1以上のMaximum Iterations、Session作成／binding成功が必要で、ComfyUI停止中でもContext、Idea、Manual Handoffを進行できる。制作アイデアはChatGPTへBootstrapを渡して初めて確定し、Commandを検証できる。`generate` は Apply（backup、slot反映、保存、validate）後、ComfyUIのRunning状態を直前確認してから実行できる。停止中は対象StageだけをWaitingUser（ComfyUI起動待ち）にする。Job完了後は存在するOutputが1件以上ある場合だけReviewへ進み、`complete` は成功Output後のReviewでのみ受理する。Iteration上限到達時は自動継続せず、ユーザー判断用のSafety Stopを設ける。

制作途中でMCPが切断された場合はConnectをWaitingUserまたはErrorへ戻し、MCP接続必須操作だけを止める。ComfyUI停止はConnectをCompletedのまま保ち、ComfyUI依存の対象StageだけをWaitingUserへ戻す。Session、Workflow選択、Project / Chat、Original Idea、Iteration／Output履歴は消去しない。再接続後は同じSessionと後段状態を維持して続行する。

`WaitingUser`は共通Stateとして維持し、`CreationStageStatus.WaitingReason`で待機理由を構造化する。Coreの表示解決はStageとReasonを組み合わせ、ConnectはComfyUI起動待ち／再接続待ち、ToChatGptはChatGPT返答待ち、Reviewはレビュー返答待ち、Iteration上限は続行判断待ちと表示する。UIがEnum名や一律のユーザー待ちを直接表示してはいけない。

## Scope

Applicable:
- Session lifecycle、Iteration、Manual Handoff、生成開始／完了／失敗／キャンセルの状態遷移。
- 新しい制作を開始する操作、明示的に有効化されたSessionのResume、既存履歴を保ったままのContext再bind。
- 起動時のWorkspaceと保存済みSessionを分離し、明示的な新規制作開始までIdea、Handoff、Output、History、Commandを空に保つ境界。
- MCP接続を制作Gateへ同期し、ComfyUI readinessは対象操作の直前だけ確認する挙動。

Do not apply:
- ComfyUI自体のJob内部状態をこのState Machineだけで推測しない。
- Session JSONを削除・移行せず、Session History／未完了Session復旧UIを自動的に追加しない。

## Evidence

- `CreationPipelineStateMachine.OrderedStages`、`EvaluateConnectionGate`、`SynchronizeConnectionGate`、`RequireConnection`、`RequireComfyUi`、`GetStageStateLabel` と `BindContext`、`BootstrapCopied`、`CommandValidated`、`OutputCompleted`、`Complete`、`ContinueBeyondLimit`。
- `MainViewModel.InitializeAsync` は保存済みSessionを内部のProvider binding用に読み込むが、`CurrentSession`には新しい非永続ドラフトを設定し、Idea、Command、Iteration、LatestOutputs、HistoryItems、HandoffItemsを復元しない。`_isCurrentSessionActivated` は false のままで、未開始ドラフトを保存しない。
- `CreationWorkspacePolicy.CanSendToChatGpt` と `MainViewModel.CanSendToChatGpt` は、MCP接続、明示的に有効化されたContext-bound Session、Loaded slot schema、非空Idea、IDEA段階、非実行JobをSEND条件とし、ComfyUIの起動状態を要求しない。
- `MainViewModel.ConnectAsync` はMCP接続成立をConnectへ同期し、`server_info.running`は詳細表示とComfyUI依存操作の直前確認に使う。MCP接続だけでConnectはCompletedになる。
- `CreationPipelineStateMachineTests` は未接続、接続中、MCP接続完了後のComfyUI非依存Context／Handoff、ComfyUI依存GenerateのWaitingUser、接続失敗、制作途中切断時のデータ保持、再接続継続に加え、既存の正常完了・失敗・上限停止を検証する。
- `CreationPipelineStateMachineTests` はWaitingUserのStage別理由（ComfyUI起動、ChatGPT返答、レビュー返答、続行判断）と表示ラベルを検証する。

## Verification

1. `CreationPipelineStateMachine.OrderedStages` とConnect Gate／各遷移メソッドを現在コードで再確認する。
2. `dotnet test tests/ChatGPTComfyConnector.Tests/ChatGPTComfyConnector.Tests.csproj -c Release` を実行し、Pipelineテストを確認する。
3. Session persistenceを変更する場合は `PortableStore` と `SessionAndStorageTests` も併せて確認する。
4. `MainViewModel.InitializeAsync`で保存済みSessionがWorkspaceへ展開されず、未開始ドラフトが保存されないことを確認する。
5. `CreationWorkspacePolicyTests`でSEND条件（未開始、未接続、slot未取得、空Idea、実行中Job、Idea送信後）とComfyUI停止中の許可を確認する。
6. コード／テストで未接続のCurrent、接続処理中のInProgress、MCP接続完了後のContext／Handoff、ComfyUI依存StageのWaitingUserを確認する。Computer UseによるGUI確認はこの変更では実施しない。
