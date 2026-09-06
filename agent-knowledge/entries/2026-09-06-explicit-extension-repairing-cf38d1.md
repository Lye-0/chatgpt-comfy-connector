---
id: rm-20260906-explicit-extension-repairing
topic: browser-extension-pairing
type: pattern
status: active
maturity: candidate
created: 2026-09-06
last_verified: 2026-09-06
source_commit: "0d0e6b6"
related_files:
  - src/ChatGPTComfyConnector.Infrastructure/Bridge/BrowserExtensionBridge.cs
  - src/ChatGPTComfyConnector.Infrastructure/Storage/PortableStore.cs
  - src/ChatGPTComfyConnector.Desktop/ViewModels/MainViewModel.Pairing.cs
  - src/ChatGPTComfyConnector.Desktop/MainWindow.xaml
  - tests/ChatGPTComfyConnector.Tests/BrowserExtensionBridgeTests.Pairing.cs
  - docs/browser-extension-bridge.md
tags:
  - pairing
  - migration
  - revocation
  - setup
supersedes: rm-20260906-extension-pairing-migration
promoted_to: null
---

# 再ペアリングはSETUPの明示操作で認証だけを更新する

## Conclusion

読み込み先フォルダーの変更や再インストール等で拡張機能側のcredentialを失ったときは、SETUPの再ペアリング操作を使う。通常起動でコードを再発行する変更は、保存済みペアリングを維持する信頼境界を壊す。再ペアリングは設定フォームの保存・キャンセルから独立した即時操作で、保存済みverifierの削除を先に確定し、成功後に旧token・socket・保留通信・media登録を無効化して新しいコードを発行する。削除失敗時は旧接続を維持する。

## Scope

Applicable:
- Desktopのconfigを維持したまま拡張機能ID・profile・接続情報を変更する移行。
- SETUP操作と認証の取消・保存・障害復旧を変更する作業。

Do not apply:
- 通常のネットワーク再接続や、storageを維持した拡張機能更新。
- Workflow、Session、出力ファイルのリセット要求。

## Evidence

- `BrowserExtensionBridge.ResetPairingAsync`: lifecycle/pairing gate、永続化優先、旧認証の失効、新コードと試行回数の更新。ネットワークAPIとしては公開しない。
- `HandleBootstrapAsync`と`TryReplaceClientAsync`: credential検証からtoken発行までを再設定と直列化し、token検証とsocket登録をrevocationと同じlockで行う。旧helloの拒否で新接続の状態を上書きしない。
- `MainViewModel.Pairing.cs`: 処理中ガード、即時操作、SETUPの保存・×からの独立。既存のSessionや設定値を初期化しない。
- `BrowserExtensionBridgeTests.Pairing.cs`: 旧認証失効、新接続、永続化と他データの保持、削除失敗、旧helloの競合、試行回数の更新を検証。
- `docs/browser-extension-bridge.md`のRe-pairing from Desktop SETUPが現行仕様を所有する。

## Verification

1. Bridge認証処理のgate/lockとSETUPの可否条件を再確認する。
2. `dotnet test`でBridgeの再ペアリングテストを実行する。実利用中のペアリング情報を消して検証しない。
3. 保存失敗、再発行中の連打・保存・×、旧helloが新接続後に届く場合を確認する。
4. SETUPのキャンセルで入力値が戻っても、明示的な再ペアリングが取り消されないことを確認する。
