ChatGPT Comfy Collector（ブラウザー拡張機能）v{{VERSION}}です。

1. Assetsから **{{ZIP}}** をダウンロードします。
2. ZIPの中身を、継続して使うフォルダー（例：`C:\AI\ChatGPT-Comfy-Collector`）へすべて展開します。
3. Edgeの`edge://extensions`で **開発者モード** をオンにします。
4. **展開して読み込み** を押し、`manifest.json`が入っているフォルダーを選びます。Chromeでは`chrome://extensions`の **パッケージ化されていない拡張機能を読み込む** を使います。
5. 起動中のConnector本体に表示されたペアリングコードを、コレクタのポップアップへ入力して **PAIR DESKTOP** を押します。

利用中は開発者モードを有効にし、読み込んだフォルダーを保持してください。Windows版Connector本体と、ログイン済みのChatGPTが必要です。

更新時は制作を停止し、同じフォルダーへ新しいZIPの中身を上書きして、拡張機能管理画面の **再読み込み** を押します。ペアリングをやり直す場合はConnectorの **SETUP → 拡張機能を再ペアリング** を使います。

[コレクタの導入・更新手順](https://github.com/Lye-0/chatgpt-comfy-connector/blob/main/browser-extension/README.md) · [本体の操作手順](https://github.com/Lye-0/chatgpt-comfy-connector/blob/main/README.md)

Assetsの`.zip.sha256`ファイルでZIPのSHA-256を確認できます。
