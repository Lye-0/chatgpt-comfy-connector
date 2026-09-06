---
id: rm-20260906-setup-validation-guidance
topic: setup-validation
type: constraint
status: active
maturity: reused
created: 2026-09-06
last_verified: 2026-09-07
source_commit: "d95fc27"
related_files:
  - docs/architecture.md
  - src/ChatGPTComfyConnector.Desktop/ViewModels/MainViewModel.cs
  - src/ChatGPTComfyConnector.Desktop/ViewModels/MainViewModel.Guidance.cs
  - src/ChatGPTComfyConnector.Desktop/MainWindow.xaml.cs
tags:
  - setup
  - validation
  - guidance
  - normalization
  - property-changed
supersedes: null
promoted_to: null
---
# SETUPの検証は案内更新からも呼ばれるため入力を書き換えない

## Conclusion

`ValidateSettings` は保存・接続に加え、`Settings_PropertyChanged` → `RefreshGuidance` → `IsGuidanceSetupReady` から入力中にも呼ばれる。ここにパス補完などの代入を含めると、保存操作より前に入力値が変わり、関連設定の更新順序にも影響する。検証は候補を返すだけにし、設定値の正規化は保存・CONNECTの `ValidateAndNormalizeSettings` で全項目の検証後に行う。

## Scope

Applicable:
- SETUPのパス補完、値の正規化、検証、案内の準備完了判定。
- 検証の再利用先を増やす場合や、PropertyChangedに連動した副作用を調べる場合。

Do not apply:
- 明示的な保存・接続の設定確定まで禁止する規則ではない。
- 生成・Workflowなど別の検証処理が同じ呼び出し関係を持つとは推定しない。

## Evidence

- `MainViewModel.Guidance.IsGuidanceSetupReady` は `ValidateSettings` を呼び、`RefreshGuidance` は `Settings_PropertyChanged` から実行される。
- runtimeディレクトリ補完を検証関数内で行った試作では、保存前に `ComfyMcpPath` が実行ファイルへ変わることを一時WPFハーネスで確認。正規化を明示操作の関数へ分離した。
- 一時WPFハーネスの25項目で、入力中のディレクトリ保持、保存時の補完と永続化、関連CLIの追従、欠落時の保存・CONNECT拒否、他項目が無効な場合の入力保持、キャンセル、実コンパイル済み主要パス表示とOpen対象の追従を検証した。
- Releaseソリューションのビルドは警告・エラー0件、既存.NETテスト241件成功。実MCP・ComfyUIプロセスの起動は不要だった。
- 2026-09-07のCLI移行修正でも検証と正規化の分離を維持し、一時WPFハーネス26項目で入力保持・拒否・保存とcompiled bindingを再確認した。直接実行ファイル入力でもCLIは同じruntimeへ更新する。候補を返す型は `ComfyMcpRuntimePaths` になったが、案内経路は読み取りのみである。

## Verification

1. `ValidateSettings` の全呼び出し元をpartialクラス全体で検索し、案内経路を含めて読む。
2. ディレクトリ入力直後は値が保持され、明示保存後は実在する子のMCP実行ファイルが保存されることをViewModelで確認する。
3. 子の実行ファイルがない場合と別設定が無効な場合を確認し、保存前の入力・永続設定・既存警告経路が保持されることを検証する。
