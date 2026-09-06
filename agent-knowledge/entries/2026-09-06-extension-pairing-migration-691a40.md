---
id: rm-20260906-extension-pairing-migration
topic: browser-extension-pairing
type: constraint
status: superseded
maturity: reused
created: 2026-09-06
last_verified: 2026-09-06
source_commit: "0d0e6b6"
related_files:
  - src/ChatGPTComfyConnector.Infrastructure/Bridge/BrowserExtensionBridge.cs
  - src/ChatGPTComfyConnector.Infrastructure/Storage/PortableStore.cs
  - browser-extension/background.js
  - browser-extension/popup.html
  - tests/ChatGPTComfyConnector.Tests/BrowserExtensionBridgeTests.cs
  - docs/browser-extension-bridge.md
tags:
  - browser-extension
  - pairing
  - migration
  - reinstall
supersedes: null
promoted_to: null
---

# 拡張機能の接続情報を失う移行にはDesktop側の再ペアリングが必要

SETUPの明示的な再ペアリング実装により、この記録の「再設定操作がない」という制約は解消した。現在の境界は `rm-20260906-explicit-extension-repairing` を参照する。以下は実装前の根拠を保持する。

## Conclusion

Desktopの保存済みペアリングと、拡張機能の`chrome.storage.local`に保存したcredentialは一対の状態である。Desktopは保存済みペアリングがあると再起動してもコードを再発行しない。拡張機能ID・プロファイルの変更や再インストールでcredentialを引き継げない場合、通常のCONNECTとDesktop再起動だけでは復旧できない。手動導入版からストア版への移行を設計するときは、この状態を初回導入と区別する。

## Scope

Applicable:
- Desktopのconfigを維持し、拡張機能側の接続情報だけを失う移行・再導入。
- 保存済みペアリングがあるのに拡張機能が初回コードを要求する状況。

Do not apply:
- 新しいDesktop設定と新しい拡張機能の初回ペアリング。
- 同一拡張機能のstorageが維持される通常更新や、一時的なWebSocket切断。

## Evidence

- `BrowserExtensionBridge.StartAsync`: 保存済みrecordがあると`_pairingCode`をnullにする。意図せぬ再ペアリングを防ぐ設計コメントがある。
- `PortableStore.LoadBrowserExtensionPairingAsync`と`SaveBrowserExtensionPairingAsync`: Desktop側はconfig内に検証値を永続化する。
- `background.js`: `storePairing`は拡張機能storageへcredentialを保存し、`connect`はcredential欠落時に`pairing_required`を返す。
- `popup.html`と現行Bridge APIにはユーザーがDesktopの保存済みペアリングを再設定する操作がない。
- `PortableStorePersistsPairingVerifierAcrossBridgeInstances`は再起動後もコードがnullで、元のcredentialが必要なことを検証する。Bridgeテスト19件成功。
- `docs/browser-extension-bridge.md`のpair/bootstrap仕様が、この永続化と認証の境界を説明する。

## Verification

1. Desktop側の再ペアリングAPI・UIや移行手順が追加されていないか確認する。
2. テスト用Desktop設定で一度ペアリングし、credentialを持たない別のテスト用拡張機能から接続した場合を検証する。実利用の接続情報を調査目的で消さない。
3. 復旧方法を設計するときも、起動のたびにコードを公開する変更へ短絡せず、ユーザーの明示操作を認証再設定の境界にする。
