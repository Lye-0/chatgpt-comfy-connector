---
id: rm-20260907-mcp-runtime-cli-affinity
topic: comfy-mcp-runtime
type: failure
status: active
maturity: candidate
created: 2026-09-07
last_verified: 2026-09-07
source_commit: "d95fc27"
related_files:
  - docs/architecture.md
  - src/ChatGPTComfyConnector.Core/Services/ComfyMcpRuntimePaths.cs
  - src/ChatGPTComfyConnector.Desktop/ViewModels/MainViewModel.cs
  - src/ChatGPTComfyConnector.Infrastructure/Mcp/ComfyMcpClient.cs
  - tests/ChatGPTComfyConnector.Tests/ComfyMcpRuntimePathTests.cs
tags:
  - comfy-mcp
  - comfy-cli
  - migration
  - persisted-settings
  - COMFY_BIN
supersedes: null
promoted_to: null
---
# MCPとCLIは同じ選択runtimeから解決し古い保存値を引き継がない

## Conclusion

MCPに接続できても、`list_workflow_slots` で旧runtimeの `comfy.exe` が見つからず失敗する場合がある。v1.0.2ではSETUPでMCP実行ファイルを直接指定すると `ValidateAndNormalizeSettings` が早期returnし、非nullの保存済み `ComfyCliPath` が残った。transportはその値を `COMFY_BIN` に優先して渡すため、MCPのみ新しいruntime、CLIのみ旧runtimeになる。

現在は `ComfyMcpRuntimePaths.Resolve` がMCP入力と同じフォルダーのCLIを一緒に解決・存在確認する。SETUPはフォルダー入力と実行ファイル入力の両方でこの組を確定し、transportも同じresolverから `COMFY_BIN` を作る。旧 `ComfyCliPath` は設定互換用フィールドとして残るが独立したoverrideではない。

## Scope

Applicable:
- runtime移動、別PCへの設定移行、実行ファイルの再指定、MCP接続成功後のCLI not-found。
- Desktopを経由しない `ComfyMcpClient` 利用でも保存済みCLI値を参照させない境界。

Do not apply:
- 将来別CLIの明示選択機能を設計する際に、その選択を黙って無視する根拠にはしない。現在のSETUPではruntimeを1つ選ぶ契約である。
- 文字コードやCLI自身の起動障害をすべてこの原因と断定しない。

## Evidence

- 本番v1.0.2のPortable設定でMCPは移動後の実在ファイル、CLIは移動前の存在しないファイルを指していた。ログのslot取得エラーが旧CLIパスと一致した。
- 旧 `SaveSetupAsync` の `ComfyCliPath ??=`、旧正規化の実行ファイル入力時の早期return、旧transportの `settings.ComfyCliPath ?? ...` が古い値を保持する経路だった。
- 新resolverの回帰テストではフォルダー・末尾区切り・実行ファイル入力を確認し、選択runtimeのCLIが欠落している場合は旧CLIが存在していても接続前に拒否することを検証した。
- 明示的な実環境テストで存在しない旧CLI値を渡し、本番runtimeと既存Workflowから `list_workflow_slots` を通じて26 slotsを取得した。Workflow編集・画像生成は実施していない。
- Releaseビルドは警告・エラー0件、.NETテスト248件成功。別の一時WPFハーネス26項目で、直接入力の保存時に既存の旧CLIも置換・永続化されることとSETUPの既存契約を確認した。

## Verification

1. 稼働版の設定とログで `ComfyMcpPath` / `ComfyCliPath` / not-foundのパスを照合し、それぞれの存在を確認する。
2. `COMFY_BIN` の全代入とSETUP正規化を調べ、選択runtime以外の保存済みCLI値が実行に使われないことを確認する。
3. `ComfyMcpRuntimePathTests` を実行する。実環境の再検証は `docs/architecture.md` に示すopt-inフラグと明示パスを使い、slot取得だけを行う。
4. SETUPの検証は案内からも呼ばれるため、正規化を検証関数へ戻さない。関連記録 `rm-20260906-setup-validation-guidance` を参照する。
