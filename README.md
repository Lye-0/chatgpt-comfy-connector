# ChatGPT Comfy Connector

ChatGPTを制作判断・改善役として使い、ローカルのComfyUI Workflowを安全に反復実行するWindows Portable Connectorです。

v0.2 AlphaのPhase 1では、ChatGPT画面の自動操作はまだ行いません。Connectorが自己完結したBootstrap / Review Handoffをクリップボードへ作成し、ユーザーが通常のChatGPTへCopy/Pasteします。ChatGPTから返った `comfy-connector/1` Connector Response（小さなCommand JSON + 必要なRaw Payload）をConnectorへ貼り付け、内容を確認してから適用・生成します。

## v0.2 Alphaの範囲

- .NET 10 / WPF / self-contained win-x64
- `v*` タグpushによるGitHub Release（win-x64 ZIP + SHA-256）
- 公式C# Model Context Protocol SDKによるcomfy-mcp stdio接続
- 初回SetupとPortable JSON/session/log/backup保存
- ComfyUI Workflow Tree、複製、名前変更、Unicode path
- `list_workflow_slots`によるdynamic slot editor
- dirty state、外部変更検出、保存前backup、3世代restore
- validate、1件だけのConnector-owned Job、cancel、status、output metadata
- Creation Session、Iteration履歴、最大反復回数（既定10）
- Manual ChatGPT Handoff、Protocol v1 command validation
- Chromium Manifest V3 Browser Extensionと`127.0.0.1`専用HTTP/WebSocket Bridge（Phase 1）
- Extensionの接続状態、ping/pong、Desktop `desktop.ready`イベント確認
- 画像のin-app preview、動画のbest-effort preview、OS既定アプリで開くfallback

モデル導入、Custom Node導入、ComfyUI更新、ChatGPT DOM自動操作、ChatGPTへの自動送信、Response取得、Installerは今回の対象外です。

## 開発

```powershell
dotnet restore ChatGPTComfyConnector.slnx
dotnet build ChatGPTComfyConnector.slnx --configuration Release
dotnet test ChatGPTComfyConnector.slnx
dotnet run --project src/ChatGPTComfyConnector.Desktop/ChatGPTComfyConnector.Desktop.csproj
```

初回Setupで次を指定します。

```text
ComfyUI Portable: C:\AI\ComfyUI_windows_portable
comfy-mcp:        C:\AI\comfy-mcp-runtime\.venv\Scripts\comfy-mcp.exe
Endpoint:         http://127.0.0.1:8188
```

ConnectorはComfyUIを自動起動しません。必要なときだけ画面の `START COMFYUI` を押します。Connector終了時にもComfyUIは終了せず、comfy-mcpだけをConnectorが所有・終了します。

現在の実環境のcomfy-mcpはinitialize応答がMCP `2025-06-18` のため、Connector側でもこのinitialize-capable protocol versionを明示しています。stdio transportが異常終了した場合は、SDKが返すprocess ID、exit code、stderr tailをPortableログへ記録します。

## Manual Handoff

1. SessionとWorkflowを選択し、`YOUR IDEA` に制作意図を書く。
2. `COPY BOOTSTRAP → CHATGPT` でContextをコピーし、通常のChatGPTへ貼る。
3. ChatGPTのJSON commandを `CHATGPT COMMAND` に貼り、`IMPORT / VALIDATE` で確認する。
4. `APPLY` または `APPLY + GENERATE` を明示的に押す。
5. 完了した出力のResult Contextをコピーし、生成した画像・動画はChatGPTへ手動添付する。

Connector commandは高レベルの `generate` / `complete` だけを受け付けます。shell、任意の実行ファイル、絶対Workflow path、未知slot、ComfyUI管理操作は受け付けません。

## Browser Extension Bridge (v0.2 Phase 1)

Desktop起動中だけ `http://127.0.0.1:43127` を開き、MV3 Extensionのbackground service workerと接続します。初回はDesktopに表示される短命のPairing codeをPopupへ入力します。以後はExtension側の保存済みpairing credentialからDesktop起動ごとのsession tokenをbootstrapし、`CONNECTED`、`PING → PONG`、`desktop.ready`を確認できます。Content Scriptは雛形のみで、ChatGPTのDOMには触れません。

Chrome / Edgeへの開発版読み込み、初回Pairing、bootstrap、endpoint、message仕様、Origin/token境界は[Browser Extension Bridge](docs/browser-extension-bridge.md)を参照してください。

## 安全な実機確認

通常のテストはGPU生成を開始しません。明示的なlive smoke testだけが既存comfy-mcpへ接続します。

```powershell
$env:RUN_LIVE_MCP = '1'
dotnet test tests/ChatGPTComfyConnector.Tests/ChatGPTComfyConnector.Tests.csproj --filter FullyQualifiedName~LiveMcpSmokeTests
Remove-Item Env:RUN_LIVE_MCP
```

実生成を行う場合は、指定されたテストWorkflowだけを対象に、slot確認 → backup → validate → 最小負荷のrun → output確認の順で実施してください。`C:\AI\comfy-mcp-runtime` のvenv再作成・更新やモデル/Nodeの変更は禁止です。

## Publish

```powershell
.\scripts\publish-win-x64.ps1
```

`artifacts/` にself-contained publish folderとPortable ZIPを作成します。GitHubへのpushやRelease作成は行いません。

GitHub Releaseは `v*` タグのpushで `.github/workflows/release.yml` が作成します。たとえば `v0.1.0-alpha` では、次の成果物が添付されます。

```text
ChatGPT-Comfy-Connector-v0.1.0-alpha-win-x64.zip
ChatGPT-Comfy-Connector-v0.1.0-alpha-win-x64.zip.sha256
```

## 技術文書

- [Architecture](docs/architecture.md)
- [Connector Protocol v1](docs/connector-protocol-v1.md)

## Known limitations

- ChatGPTの実Project/Chat一覧やConversation IDは取得しません。保存するのはlocal labelと将来拡張用metadataです。
- Browser Extensionは現在、接続確認と双方向診断イベントだけを扱い、ChatGPTの入力・送信・Response取得は行いません。
- Windowsのcodecが対応しない動画はin-app previewできない場合がありますが、生成失敗とは扱わずOS既定アプリで開けます。
- comfy-mcpの実ランタイムが参照するPythonやComfyUIの状態は外部依存です。Connectorはstderrと終了状態をログへ記録します。
