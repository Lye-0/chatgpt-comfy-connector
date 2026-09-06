---
id: rm-20260906-extension-test-crlf
topic: browser-extension-testing
type: failure
status: active
maturity: reused
created: 2026-09-06
last_verified: 2026-09-06
source_commit: "0d0e6b6"
related_files:
  - tests/browser-extension/background.test.mjs
  - browser-extension/background.js
tags:
  - browser-extension
  - node-test
  - crlf
  - reconnect
supersedes: null
promoted_to: null
---

# Backgroundテストは改行を正規化してから起動処理を除去する

## Conclusion

Backgroundテストは実コードの改行をLFへ正規化してから、末尾の自動接続を文字列置換で除去する。この正規化を外すと、WindowsのCRLF作業コピーでは置換が一致せず、各fixtureから予定外のhealth取得と再接続タイマーが動く。media処理のfetch回数に余分な1回が加わり、通常のNodeテストプロセスも終了しなくなる。ファイルの改行差を製品のmedia送信回帰と混同しない。

## Scope

Applicable:
- `background.js`の改行やテスト冒頭の正規化・起動処理除去を変更する検証。
- fetch回数が期待値より1多い失敗、全テスト後も残る再接続タイマーの調査。

Do not apply:
- 正規化が有効な状態で発生したfetch回数の失敗を、改行問題と断定する用途。
- 実ブラウザーでの送信不具合や、他の原因によるタイマー残存。

## Evidence

- `tests/browser-extension/background.test.mjs`: 冒頭のsource読み込みと`.replace("ensureReconnectAlarm();\nconnect().catch(() => {});", "")`、`createHarness`の実`setTimeout`と記録付きfetch。
- `browser-extension/background.js`: 末尾の自動接続、`connect`のhealth取得、`scheduleReconnect`。
- Windows作業コピーでは置換対象が不一致。終了を強制する既存runnerオプションで結果を回収すると463件中460件成功、mediaのfetch回数検証3件失敗。
- リポジトリを変更せず、一時コピーの`background.js`だけCRLFからLFへ変換した対照実験では、同じテスト463件がすべて成功し、通常のrunnerが終了した。
- 修正としてsource読み込み直後に`.replace(/\r\n/g, "\n")`を追加した。Windows作業コピーとNode.js 24の通常runnerで463件が全て成功し、終了することを再検証した。

## Verification

1. source読み込み・起動処理除去とファイルの改行形式を再確認する。
2. 同じテストをCRLFとLFのコピーで実行し、fetch回数とプロセス終了を比較する。
3. 修正する場合はテスト側の改行正規化または改行非依存の起動分離を検討し、終了強制だけで問題を解消したと扱わない。
