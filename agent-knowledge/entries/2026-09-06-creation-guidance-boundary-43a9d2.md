---
id: rm-20260906-creation-guidance-boundary
topic: creation-guidance
type: constraint
status: active
maturity: candidate
created: 2026-09-06
last_verified: 2026-09-06
source_commit: null
related_files:
  - docs/architecture.md
  - src/ChatGPTComfyConnector.Core/Services/CreationGuidancePolicy.cs
  - src/ChatGPTComfyConnector.Core/Services/ChatGuidanceProgress.cs
  - src/ChatGPTComfyConnector.Desktop/ViewModels/MainViewModel.Guidance.cs
  - src/ChatGPTComfyConnector.Desktop/ViewModels/MainViewModel.cs
  - tests/ChatGPTComfyConnector.Tests/CreationGuidanceTests.cs
tags:
  - guidance
  - pipeline
  - selection
  - confirmation
  - async-race
supersedes: null
promoted_to: null
---
# 操作案内の確認状態はSessionの実行条件から独立させる

## Conclusion

制作の枠点滅はCoreの純粋な案内判定から1対象を選ぶ。案内を見た／選択欄を確認した事実は、WorkflowBound / ChatBound、Handoff境界、Commandの検証、既存Can系条件を変更しない。自動処理中は次の実行ボタンを案内しない。

CHATの案内は再取得→Project確認→Chat確認→制作開始を進むが、Catalogのキャッシュ表示と自動選択だけでは利用者が確認済みとは扱わない。確認状態は非永続のChatGuidanceProgressに分け、再取得の最新世代が成功したときだけRefreshedにする。再取得と新規Workspaceは確認状態を初期化し、Project変更はChatの確認を無効化する。

同じ自動選択済みProjectの確認ではSelectedProject setterが動かない場合がある。そのためConfirmProjectForGuidanceAsyncが、未取得の選択Projectに限って既存のChat取得経路を明示的に呼ぶ。取得済みキーと読み込み中状態で二重取得を防ぎ、古い取得結果が現在の案内状態を更新しないよう既存の世代／Project参照検査を通す。

## Scope

Applicable:
- 制作案内、CHAT選択確認、非同期Catalog／選択Projectの取得、同じ行の再確認。
- 案内の追加によって自動Apply／GenerateやHandoff再送を誘発しない境界。

Do not apply:
- 案内の確認状態を永続Sessionの完了フラグや送信許可として利用しない。
- ガイド表示を理由に新規Handoff、Job、Project/Chat取得を自動開始しない。

## Evidence

- CreationGuidancePolicy.Resolveは既存stateとCan系条件から対象を返すだけである。
- ChatGuidanceProgressとMainViewModelのCatalog読込世代検査が確認状態を分離する。
- MainViewModel.GuidanceのConfirmProjectForGuidanceAsyncとMainViewModelのLoadSelectedProjectChatsAsyncが、同じ選択の取得と古い結果の破棄を扱う。
- CreationGuidanceTestsは初期案内、同じ選択と変更／再取得、手動／自動実行、復旧、上限判断、Session非変更を検証する。
- WPF描画とViewModelを用いた検証で、同じProjectの初回確認による取得、再確認時の二重取得抑制、1対象の強調、処理中抑制を確認した。

## Verification

1. CreationGuidancePolicyと既存Can系条件の対応、Sessionへの書込みがないことを確認する。
2. dotnet test tests/ChatGPTComfyConnector.Tests/ChatGPTComfyConnector.Tests.csproj -c Release --filter FullyQualifiedName~CreationGuidanceTests を実行する。
3. MainViewModelのRoot再取得、同じProjectの確認、Project変更、古い結果の処理を再確認する。
4. UI変更時はGuideHighlightが内容や選択値を置き換えず、1対象の枠だけを描画することをWPFで確認する。
