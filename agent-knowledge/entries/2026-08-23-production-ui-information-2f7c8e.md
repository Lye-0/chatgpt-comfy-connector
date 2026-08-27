---
id: rm-20260823-production-ui-information
topic: production-ui
type: decision
status: active
maturity: candidate
created: 2026-08-23
last_verified: 2026-08-23
source_commit: "4b7976c"
related_files:
  - docs/architecture.md
  - src/ChatGPTComfyConnector.Desktop/MainWindow.xaml
  - src/ChatGPTComfyConnector.Desktop/MainWindow.xaml.cs
  - src/ChatGPTComfyConnector.Desktop/ViewModels/MainViewModel.cs
  - src/ChatGPTComfyConnector.Desktop/ViewModels/HandoffTimelineItem.cs
tags:
  - ui
  - creation-canvas
  - workflow
  - handoff
  - state-visibility
supersedes: null
promoted_to: null
---
# UIの主役はWorkflow設定ではなく制作キャンバスである

## Conclusion

WPF desktop UIの情報設計は、左 `WORKFLOW`、中央 `CREATION`、右 `CHATGPT / SESSION` の3責務を維持する。中央はCreation Pipeline、制作アイデア、Current Output preview、Job status、Generation Historyを主役とし、右はManual Handoff TimelineとChatGPT commandのimport／validation／apply／resumeを担当する。左はWorkflow Tree、選択、複製、名前変更、詳細設定入口を担当し、dynamic slotの低レベル編集で制作キャンバスを占有しない。

ヘッダーの `Connector → MCP → ComfyUI → GPU` はSystem Connection状態であり、Creation Pipelineの進行状態とは別に表示・更新する。Connection、Workflow選択、slot loading、empty、validation、Job running／success／failure、Session safety stopは、色だけに頼らず文言・構造・focus／selected状態を含めて区別する。

ブランド的な短い英語（`CONNECTED`、`GENERATE`、`JOB` 等）は維持できるが、説明、ナビゲーション、機能名、empty stateは自然な日本語を基本とする。既存機能を削除せず、Backup／Restoreや高度なslot設定は補助ビューへ置く。

## Scope

Applicable:
- `MainWindow.xaml` の3ペイン配置、制作導線、Timeline、Workflow editor、状態表示、アクセシブルなicon-only action。
- 黒基調の既存visual languageを維持しつつ、情報優先度と操作対象を調整するUI変更。

Do not apply:
- 中央を全slot一覧やWorkflow管理説明で埋める再設計。
- Connection状態をCreation Pipelineの完了状態として扱うこと。
- 既存のManual Handoff、dynamic slot、履歴、Backup / Restore、Connect / Start ComfyUIをUI変更だけで削除すること。

## Evidence

- `MainWindow.xaml` のroot columnsと `CREATION PIPELINE`、`CREATION IDEA`、`CURRENT OUTPUT`、`HISTORY`、`Handoff Timeline`、`CHATGPT COMMAND` の構成。
- `MainViewModel` の `SystemConnectionSummary`、`PipelineStages`、`ShowDisconnectedState`、`ShowSlotLoadingState`、`ShowSlotErrorState`、`ShowNoSlotState`、`HasIterationSafetyStop`。
- `HandoffTimelineItem` とTimeline templateの方向別色、本文／metadata分離、Tooltip、focus／hover、copy buttonのAutomationProperties。

## Verification

1. レイアウト変更後もWorkflow選択 → slot取得 → idea → Handoff → command apply → generate → output → historyの導線を追う。
2. Connection stateとCreation stateを個別に変化させ、相互に誤表示しないことを確認する。
3. Release buildと関連テストを実行し、実画面確認を行った場合は未実施の環境・入力条件を別途明記する。
