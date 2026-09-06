---
id: rm-20260906-mcp-cli-entrypoint
topic: comfy-mcp-runtime
type: case
status: active
maturity: candidate
created: 2026-09-06
last_verified: 2026-09-06
source_commit: "0bf0ec0"
related_files:
  - src/ChatGPTComfyConnector.Infrastructure/Mcp/ComfyMcpClient.cs
  - src/ChatGPTComfyConnector.Desktop/ViewModels/MainViewModel.cs
  - tests/ChatGPTComfyConnector.Tests/LiveMcpSmokeTests.cs
tags:
  - comfy-mcp
  - setup
  - entrypoint
  - cp932
  - diagnostics
supersedes: null
promoted_to: null
---
# MCP接続時のCLIバナーエラーは実行ファイルの指定を先に確認する

## Conclusion

MCP接続直後の `exitCode=1` と `UnicodeEncodeError: cp932` は、MCP本体の文字コード障害とは限らない。リリース版v1.0.1で、保存済み `ComfyMcpPath` が `comfy.exe` を指し、comfy-cliのバナー出力が失敗する事例を確認した。同じvenvの `comfy-mcp.exe` への接続は成功した。文字コード環境変数やPython環境を変更する前に、保存済み実行ファイルとログの最初の呼び出し元を照合する。

## Scope

Applicable:
- CONNECT直後にstdio child processが終了し、ログが `comfy_cli/cmdline.py` の `intro_banner` やRichの描画処理を示す場合。
- 初期候補パスと保存済み設定が異なる場合。起動時には保存済み設定が優先される。

Do not apply:
- 正しいMCP実行ファイルから発生した文字コード障害を、この事例だけで設定ミスと断定しない。
- この事例のローカル配置を他環境の正しいインストール場所として固定しない。

## Evidence

- v1.0.1のPortable設定で `ComfyMcpPath` と `ComfyCliPath` がともに `comfy.exe` を指していた。Portableログの最初のスタックは `comfy_cli/cmdline.py` のバナー描画、最後は文字U+2588に対するcp932のエンコード失敗だった。
- `ComfyMcpClient.ConnectAsync` は `ComfyMcpPath` を引数なしで起動し、CLIの場所は別途 `COMFY_BIN` に渡す。
- `MainViewModel.InitializeAsync` は保存済み `ComfyMcpPath` を読み込み、初期候補を上書きする。
- 既存のReleaseテストバイナリで `LiveMcpSmokeTests.ConnectsToConfiguredComfyMcpWhenExplicitlyEnabled` を `RUN_LIVE_MCP=1` として実行し、実在する同じvenvの `comfy-mcp.exe` に接続成功。ツール一覧と `server_info` の読み取りのみで、画像生成は行っていない。ユーザーの起動中アプリの設定は変更していない。

## Verification

1. 実行中のConnectorの配置からPortable設定を探し、MCPとCLIの実行ファイル名・存在を確認する。
2. 末尾のtransportエラーだけでなく、先頭側のstderrから起動したモジュールを確認する。
3. 設定変更候補の `comfy-mcp.exe` に、現環境の正しいパスを使った接続とサーバー情報の読み取りで検証する。CLI更新やvenv再作成を先行させない。
