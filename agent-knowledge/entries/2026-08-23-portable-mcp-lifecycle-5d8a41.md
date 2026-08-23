---
id: rm-20260823-portable-mcp-lifecycle
topic: comfy-mcp-runtime
type: constraint
status: active
maturity: candidate
created: 2026-08-23
last_verified: 2026-08-23
source_commit: "4b7976c"
related_files:
  - README.md
  - docs/architecture.md
  - src/ChatGPTComfyConnector.Core/Models/AppModels.cs
  - src/ChatGPTComfyConnector.Infrastructure/Mcp/ComfyMcpClient.cs
  - tests/ChatGPTComfyConnector.Tests/LiveMcpSmokeTests.cs
  - tests/ChatGPTComfyConnector.Tests/LiveWorkflowSmokeTests.cs
tags:
  - comfy-mcp
  - stdio
  - lifecycle
  - diagnostics
  - portable
  - live-test
supersedes: null
promoted_to: null
---
# comfy-mcpは外部ランタイムとして厳密なstdio診断を行う

## Conclusion

Connectorはself-contained `win-x64` WPFアプリとしてPortable領域へ設定、Session、log、backupを保存し、設定された既存の `comfy-mcp.exe` を `StdioClientTransport` で起動する。接続時は `COMFY_BIN`、`COMFY_PROJECT`、`COMFYUI_URL`、`COMFYUI_HOST` を明示し、現在のinitialize-capable MCP protocol revision `2025-06-18` を要求する。

Connectorが所有するのはMCP clientとそのstdio child processだけで、ComfyUI自体は自動停止しない。モデル、Custom Node、ComfyUI、venvの更新・再作成をConnectorの通常処理や診断の前提にしない。stdio接続失敗は、待機していることやhelp出力の有無だけで判断せず、実際のtransport exception、process ID、exit code、stderr tailをPortable logへ記録して原因を切り分ける。

## Scope

Applicable:
- Setup、Connect / Disconnect、MCP protocol negotiation、stderr／transport diagnostics、Portable publish、live smoke test。
- 実環境のcomfy-mcpやPython venvを変更せずにConnector側の接続原因を調べる場合。

Do not apply:
- ConnectorからComfyUIのmanagement tool、model download、node install、version switching、venv再作成／更新を行わない。
- `--help` がstdio serverとして入力待ちになる可能性を起動失敗と断定しない。Connector経由の実例と診断情報を優先する。

## Evidence

- `ComfyMcpClient.ConnectAsync` がconfigured executableの存在、環境変数、`StdioClientTransport`、MCP protocol version、stderr callbackを定義する。
- `ClientTransportClosedException` の `ProcessId`、`ExitCode`、`StandardErrorTail` を `FormatStdioDiagnostics` でまとめ、`PortableStore.LogAsync` へ記録する。
- `DisconnectAsync` / `DisposeAsync` はMCP clientとtransportを破棄するが、ComfyUIを停止する処理はない。
- `README.md` の初回Setup、process lifecycle、safe live test節と `LiveMcpSmokeTests` / `LiveWorkflowSmokeTests` が実環境テストを環境変数で明示的に分離する。

## Verification

1. 実環境診断では設定された `ComfyMcpPath`、Python／venvの存在、Connector経由のstderr・exit情報を個別に確認する。
2. protocol変更時は `ComfyMcpProtocolVersion` と実ランタイムのinitialize応答を確認する。
3. live testは `RUN_LIVE_MCP=1` または `RUN_LIVE_WORKFLOW=1` を明示した場合だけ実行し、実生成の有無を報告する。
