# ChatGPT Comfy Connector

ChatGPTを制作判断・改善役として使い、ローカルのComfyUI Workflowを安全に反復実行するWindows Portable Connectorです。

v0.2 Alphaでは、Browser Extensionとのlocalhost通信、現在アクティブな `https://chatgpt.com/` チャットへのHandoff送信、Connector Response受信、strict validation後の自動APPLY / GENERATE、および生成したPrimary Outputの同じChatGPTチャットへの自動添付までを扱います。

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
- Chromium Manifest V3 Browser Extensionと`127.0.0.1`専用HTTP/WebSocket Bridge（Phase 1–5.1）
- Extensionの接続状態、ping/pong、Desktop `desktop.ready`イベント確認
- Extension接続時の現在アクティブなChatGPTチャットへのHandoff自動入力・送信（Phase 2）
- ChatGPT assistant回答の完了検知、Connector ResponseのDesktop側strict validation、`CHATGPT COMMAND`への反映（Phase 3.1–3.3）
- strict validation済み`generate` Responseの既存Apply/Generate処理への自動接続、ComfyUI readiness/start/wait、OUTPUT/HISTORY更新（Phase 4）
- ComfyUI生成完了後の現在IterationのPrimary Output（画像/動画）の同一ChatGPTタブへの認証済み自動添付（Phase 5.1）
- 画像のin-app preview、動画のbest-effort preview、OS既定アプリで開くfallback

モデル導入、Custom Node導入、ComfyUI更新、Chat一覧／Project一覧、完全自律Iteration、Installerは今回の対象外です。

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

通常のGENERATEではComfyUIのREADYを直前に確認し、STOPPEDならConnectorが設定済みの起動batchを一度だけ開始してREADYを待ちます。`START COMFYUI` は手動の明示的な起動操作として残り、Connector終了時にもComfyUIは終了せず、comfy-mcpだけをConnectorが所有・終了します。

現在の実環境のcomfy-mcpはinitialize応答がMCP `2025-06-18` のため、Connector側でもこのinitialize-capable protocol versionを明示しています。stdio transportが異常終了した場合は、SDKが返すprocess ID、exit code、stderr tailをPortableログへ記録します。

## Handoff to ChatGPT

1. SessionとWorkflowを選択し、`YOUR IDEA` に制作意図を書く。
2. Browser Extensionが `CONNECTED` なら `SEND TO CHATGPT` で、現在アクティブな
   `https://chatgpt.com/` チャットへHandoffを入力・送信する。
3. Extensionが未接続の場合は従来どおりClipboardへコピーし、ChatGPTへ手動で
   貼り付ける。自動送信に失敗した場合は同じHandoffを再送するか、Timelineの
   コピーでClipboard fallbackを使える。`COPIED` / `FAILED` の間は中央のボタン
   が同じHandoffの再送（未接続時は再コピー）として利用でき、Extensionの再接続
   だけで勝手に送信することはない。
4. ChatGPT Responseが受信されると、DesktopがPendingHandoff相関とstrict validationを行い、`generate` は既存のAPPLY → ComfyUI READY確認 → GENERATE → OUTPUT/HISTORYまで自動で進める。`complete` は既存の完了条件を検証してSessionを完了する。
5. `CHATGPT COMMAND` の `読み込んで確認`、`適用`、`適用して生成` は自動処理の失敗時・確認時の手動操作として残る。自動失敗時はCommandTextとPendingHandoffを保持する。
6. 生成が完了すると、現在IterationのPrimary Outputを同じChatGPTタブへ自動添付する。Review Handoffの次回送信、APPLY/GENERATEループは自動化しない。

Connector commandは高レベルの `generate` / `complete` だけを受け付けます。shell、任意の実行ファイル、絶対Workflow path、未知slot、ComfyUI管理操作は受け付けません。

## Browser Extension Bridge (v0.2 Phase 1–5.1)

Desktop起動中だけ `http://127.0.0.1:43127` を開き、MV3 Extensionのbackground service workerと接続します。初回はDesktopに表示される短命のPairing codeをPopupへ入力します。以後はExtension側の保存済みpairing credentialからDesktop起動ごとのsession tokenをbootstrapし、`CONNECTED`、`PING → PONG`、`desktop.ready`を確認できます。Content Scriptは `https://chatgpt.com/*` の現在アクティブなタブに限り、Desktopから届いた既存Handoff本文を入力・送信し、同じHandoff以降に生成されたassistant回答を完了後に取得します。回答はDesktop側のstrict validationを通過した場合だけ `CHATGPT COMMAND` に反映されます。`generate` はその後Desktopの既存strict Apply/Generate経路へ自動接続され、`complete` は既存条件を満たす場合だけSessionを完了します。

生成完了後はPrimary Outputを認証済みの媒体転送で同じChatGPTタブへ添付し、Review Handoff送信待ちにします。Review Handoff送信や完全自律のReview/IterationループはPhase 5.1では行いません。

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
- Browser ExtensionはPhase 5.1でも対象を初回Handoffと同じ`chatgpt.com`タブに限定します。Responseのstrict validation、Workflow変更、ComfyUI操作、生成物の登録はDesktop側が担当し、Review Handoff送信を含む完全自律のReview/Iterationループは行いません。
- Windowsのcodecが対応しない動画はin-app previewできない場合がありますが、生成失敗とは扱わずOS既定アプリで開けます。
- comfy-mcpの実ランタイムが参照するPythonやComfyUIの状態は外部依存です。Connectorはstderrと終了状態をログへ記録します。
