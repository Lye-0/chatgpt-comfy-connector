---
id: rm-20260823-workflow-safety-generation
topic: workflow-safety
type: constraint
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
  - src/ChatGPTComfyConnector.Infrastructure/Workflows/WorkflowCatalog.cs
  - src/ChatGPTComfyConnector.Infrastructure/Storage/PortableStore.cs
  - tests/ChatGPTComfyConnector.Tests/ProtocolTests.cs
  - tests/ChatGPTComfyConnector.Tests/SessionAndStorageTests.cs
tags:
  - workflow
  - slots
  - backup
  - validate
  - job
  - path-safety
supersedes: null
promoted_to: null
---
# Workflow変更と生成はGUI選択・backup・validateを境界にする

## Conclusion

ChatGPT commandはWorkflowを選択する権限を持たず、GUIで選択された `WorkflowIdentity` が唯一のWorkflow binding authorityである。Workflowは相対 `.json` pathだけを受け付け、root外、絶対path、`.` / `..` traversalを拒否する。

slotは `list_workflow_slots` から動的に取得し、Commandのparameter keyは現在のslot addressに存在するものだけを許可する。slot変更は `set_workflow_slot(stdout=false)` の前に1世代のpre-save backupを作り、validate成功を確認する。反映またはvalidateが失敗した場合はbackup restoreを試み、backupはlogical Workflowごとに最新3世代を保持する。

生成は `run_workflow(wait=false)` でConnector-owned Jobを1件投入し、`job` statusをpollしてから `fetch_outputs` する。取得した実在OutputだけをSession Iterationへ登録し、Job完了とOutput成功を混同しない。

## Scope

Applicable:
- Workflow Tree、dynamic slot editor、Command validation、保存、復元、validate、Job、Output取得。
- H3を含む汎用Workflowへ同じ安全境界を適用する場合。

Do not apply:
- ChatGPT commandから任意のabsolute Workflow path、未知slot、shell、実行ファイル、ComfyUI管理操作を受け付けない。
- live smoke testや実生成を通常のunit testに混ぜない。明示的に有効化された環境変数付きテストだけが実環境へ接続する。

## Evidence

- `WorkflowIdentity.Create` / `ToAbsolute` と `PathSafety` がrelative pathとroot containmentを検証する。
- `WorkflowCatalog.DiscoverSlotsAsync`、`ApplySlotsAsync`、`RunAsync`、`GetJobAsync`、`FetchOutputsAsync` がdynamic slot、rollback、非同期Job、output metadataの流れを実装する。
- `PortableStore.CreateWorkflowBackupAsync` は3世代をrotateし、`RestoreWorkflowBackupAsync` はrestore前の現行Workflowもbackupする。
- `ProtocolTests` は不正action、absolute/traversal path、未知slotを拒否し、`SessionAndStorageTests.WorkflowBackupsRotateToThreeAndRestoreAtomically` はbackup仕様を検証する。

## Verification

1. Workflow操作を変更する前に `WorkflowIdentity`、`WorkflowCatalog`、`PortableStore` の3層を確認する。
2. slot反映ではbackup → set (`stdout=false`) → validate → rollback境界が保たれているか確認する。
3. `ProtocolTests` と `SessionAndStorageTests` を実行し、必要な場合だけ明示的なlive smoke testを別途実行する。
