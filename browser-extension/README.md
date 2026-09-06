# ChatGPT Comfy Collector

**ChatGPTと、Windows版ChatGPT Comfy Connectorを接続するブラウザー拡張機能です。** Project / Chatの一覧取得、制作指示の送信、回答の受信、生成結果の添付を担当します。

## 用意するもの

- Windows版ChatGPT Comfy Connector本体。
- EdgeまたはChrome（Chromium 116以降）と、ログイン済みのChatGPT。
- [GitHub Releases](https://github.com/Lye-0/chatgpt-comfy-connector/releases)の`collector-v`から始まるリリースにある、`ChatGPT-Comfy-Collector-v….zip`。

本体は`desktop-v`から始まるリリースで配布します。[本体の操作手順](https://github.com/Lye-0/chatgpt-comfy-connector/blob/main/README.md)に従って制作環境を準備してください。

## 導入する

1. ZIPの中身を、継続して使うフォルダー（例：`C:\AI\ChatGPT-Comfy-Collector`）へすべて展開します。
2. Edgeで`edge://extensions`を開き、**開発者モード**をオンにします。
3. **展開して読み込み**を押し、`manifest.json`が入っているフォルダーを選びます。
4. Connector本体を起動します。
5. **ChatGPT Comfy Collector** のポップアップを開き、本体上部または **SETUP → 拡張機能の接続** に表示されたコードを入力して **PAIR DESKTOP** を押します。
6. ポップアップと、本体上部のExtensionが **CONNECTED** になったことを確認します。

Chromeでは`chrome://extensions`を開き、**デベロッパーモード → パッケージ化されていない拡張機能を読み込む**から同じフォルダーを選びます。

**利用中は開発者モードをオンにし、読み込んだフォルダーをその場所に保持してください。** 本体の起動後、接続が戻らない場合はポップアップの **CONNECT**、通信確認には **PING** を使います。

## 更新する

1. 本体で制作を停止します。
2. 新しいコレクタのZIPをダウンロードし、その中身を**現在読み込んでいるフォルダーへ上書き**します。
3. 拡張機能管理画面で **ChatGPT Comfy Collector → 再読み込み** を押します。
4. 本体との接続を確認します。

同じフォルダーを使うことで、拡張機能の識別と保存済みペアリング情報を維持できます。フォルダーを変更した場合や再インストールで接続情報を失った場合は、本体の **SETUP → 拡張機能を再ペアリング** で新しいコードを発行し、再度 **PAIR DESKTOP** を押してください。コードの有効期限は10分です。

## 開発・配布

ソースから試す場合は、このリポジトリの`browser-extension`フォルダーを直接読み込みます。

PowerShell 7で、リポジトリのルートから実行します。

```powershell
node --test tests/browser-extension/background.test.mjs tests/browser-extension/content-script.test.mjs tests/browser-extension/chatgpt-context.test.mjs
.\scripts\publish-collector.ps1 -Version '0.2.0'
```

`artifacts/collector`に、単体ZIP・SHA-256・リリース公開文を作成します。テストにはNode.js 24を使用します。`collector-v0.2.0`のようなタグをpushすると、Collectorワークフローがテスト・パッケージ作成・GitHub Releaseの公開を行います。

<details>
<summary>開発者向け：接続とタブの管理</summary>

The extension uses Chromium Manifest V3. On first use, enter the one-time
Pairing code shown by the Desktop and choose `PAIR DESKTOP`; later starts use
the saved pairing credential to bootstrap a fresh Desktop session token. The
Background service worker owns all local Bridge access and one connector-owned
Managed Execution Window containing one active Managed ChatGPT Tab. The window
is created non-focused and non-minimized; the tab is active within that window
with automatic discarding disabled. A Handoff is sent only after that tab has
passed the Content Script, Conversation, Composer, and response-watcher
readiness handshakes; the user's foreground tab is never selected as an
execution target. Conversation ID/URL is the durable target identity and the
window/tab are only replaceable browser media. The Content Script owns the
replaceable ChatGPT composer/send locators and returns a send result only after a new matching user
message containing the current Handoff identifiers is visible; it does not
read the ChatGPT response during Handoff sending. After Desktop confirms a
ComfyUI Primary Output, the Background fetches the registered bytes through the
authenticated Bridge and relays bounded chunks to the same Managed Tab; the
Content Script attaches the resulting `File` through ChatGPT's file input and
verifies the attachment. The Extension receives no local path. Textarea and
contenteditable composers use separate editor-aware input paths, and a
composer-only clear is never treated as a successful send.

See [Browser Extension Bridge](https://github.com/Lye-0/chatgpt-comfy-connector/blob/main/docs/browser-extension-bridge.md)
for the protocol, security boundary, and loading steps.

## Managed Execution Window and ChatGPT Tab

Execution is isolated from the user's foreground browser tab. The Background
service worker owns one non-focused, non-minimized Execution Window and one
active Managed ChatGPT Tab inside it. It prepares the Content Script, target
Conversation, composer, and shared assistant-response watcher before sending a
Handoff. Conversation ID/URL is the durable execution identity; the
window/tab are only replaceable browser media. If the managed tab or Execution
Window is closed or navigated during a pending operation, the Background
recreates or rebinds the active tab in the connector-owned window to the same
Conversation identity and continues the correlated watcher without sending the
Handoff again. The user's foreground Window is never focused or retargeted.
When the Execution Window is first created, its width and height are each set
to about half of the last-focused browser window (roughly one quarter of its
area); an internal fallback size is used if those bounds are unavailable.

Project/Chat discovery uses a separate non-focused Collector Window with one
active Collector Tab. The tab is reused for the root sidebar and every Project
page. Root Project discovery reuses the previously successful metadata-only
route exactly once per refresh generation: the known ChatGPT history sidebar, its visible
`data-sidebar-item="true"` rows, Project-home anchors, and the same bounded
sidebar scroll. It may expand a dedicated `さらに表示`/`もっと見る` button, but
never clicks a generic row or navigates to infer an ID; `/schedule`,
`/plugins`, search, and ordinary Chat rows therefore cannot become Project
targets. The tab is never used for Handoff, media, Review, Resume, or
assistant-response observation. A route-less Project entry is incomplete
discovery and causes a bounded refresh to fail rather than triggering
navigation to guess its identity. The Collector Window is independent from the
Managed Execution Window and the user's foreground tabs. Its metadata-only
snapshot is persisted by Desktop so the previous list can be shown while a
new bounded refresh runs. It starts at about half the reference window width
and height (with an outer-width floor near 820px), then verifies the Content
Script viewport and desktop sidebar structure without scrolling or collecting
Project rows. The one-shot locator call then selects the visible sidebar shell
and one Project-owning element whose `scrollTop` actually moves, collects after
each lazy-load settle using monotonically increasing scroll positions, restores
the saved position once, and requires bottom/no-growth plus a discovered
Project section before completion. A bounded zero-Project result fails as
`context_projects_incomplete` instead of being published as an empty
successful snapshot. Window membership is reconciled before the single root
scan so the
initial `windows.create({ url })` Tab is reused and duplicate Collector Tabs
are removed.

After the Root Project catalog is resolved, Project-page collection uses only
the current Project's Chat containers and its own bounded scroll-completion
state. It does not require the Root Project sidebar to remain complete; a
failed Project Chat scan is reported as `context_project_chats_incomplete`.

</details>
