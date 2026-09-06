# 本体とコレクタのリリース

本体とコレクタは、同じリポジトリのGitHub Releasesで個別に配布する。

| コンポーネント | タグ | ワークフロー | ZIP |
|---|---|---|---|
| 本体 | `desktop-v<SemVer>` | `release-desktop.yml` | `ChatGPT-Comfy-Connector-v<SemVer>-win-x64.zip` |
| コレクタ | `collector-v<SemVer>` | `release-collector.yml` | `ChatGPT-Comfy-Collector-v<SemVer>.zip` |

## バージョンと互換性

タグのSemVerを配布物のバージョンとして使用する。プレリリース識別子を持つ版は、GitHub ReleaseでもPre-releaseとする。各数値部分は配布形式に合わせて0〜65535とし、コレクタでは全て0の版を拒否する。

本体は`dotnet publish -p:Version=...`へ渡し、GitHub Actionsでは`SourceRevisionId`にビルド対象のコミットSHAを設定する。コレクタは一時コピーのmanifestに数値部分を`version`、SemVer全体を`version_name`として設定する。例えば`1.2.3-rc.1`はそれぞれ`1.2.3`と`1.2.3-rc.1`になる。元のプロジェクト・manifestは変更しない。

本体とコレクタのリリース番号は独立している。通信の互換性は[Browser Extension Bridge](browser-extension-bridge.md)のプロトコルに従い、タグの数値が等しいことを接続条件にしない。

## パッケージ作成

PowerShell 7の`publish-win-x64.ps1`と`publish-collector.ps1`を、ローカルとCIの両方で使う。既定の出力先は`artifacts/desktop`と`artifacts/collector`。ZIP、SHA-256、バージョンを埋め込んだリリース公開文を生成する。

本体は自己完結したWindows x64アプリと導入案内を含む。コレクタは明示した実行ファイル群とREADMEだけを含み、`manifest.json`をZIP直下に置く。本体とコレクタを別々のZIPにまとめ、利用者が両方を取得する。

パッケージ作成には出力先の一時フォルダーを使い、終了時にそのフォルダーだけを削除する。既存の実運用フォルダーをステージングに使用しない。ビルド失敗時はZIPを作成しない。

## GitHubへの公開

タグpushに対して対象のワークフローだけが起動する。各ワークフローはタグの検証、配布スクリプトのテスト、対象コンポーネントのテスト、パッケージ作成の順に実行する。本体は.NET、コレクタはNode.js 24のテストを使う。

`publish-github-release.ps1`は、コンポーネント・タグ・ファイル名とSHA-256の一致を検証してから、明示したリポジトリに対してGitHub CLIを実行する。

1. 対象タグのReleaseを確認する。権限エラー等を「Releaseがない」と扱わない。
2. 新規の場合は既存のリモートタグを確認して下書きを作成する。
3. ZIPとSHA-256を添付する。
4. 添付成功後に公開状態へ変更する。

同一タグの再実行は同じReleaseを再利用し、配布ファイルを更新する。同一タグのワークフローは同時実行しない。アップロード失敗時に新規Releaseを公開しない。既存Releaseの本文は利用者の編集内容を保持する。

GitHubのLatest表示はリポジトリに1つのため、コレクタには`--latest=false`を指定する。本体のダウンロード導線がコレクタの公開で切り替わらないようにする。認証には公開ステップだけへ渡す`GITHUB_TOKEN`と`contents: write`権限を使う。

## コレクタの導入と更新

利用者はZIPを固定フォルダーへ展開し、ブラウザーの開発者モードを有効にして、manifestがあるフォルダーを読み込む。利用中はそのフォルダーを保持する。更新は同じフォルダーへの上書きと拡張機能の再読み込みで行う。

読み込み先の変更や再インストールでペアリング情報を失った場合は、本体のSETUPで再ペアリングする。詳しい操作は[コレクタのREADME](../browser-extension/README.md)を参照。

## 検証

`tests/distribution/release-scripts.tests.ps1`は、タグ・バージョンの拒否条件、ZIPの構成、manifestへの版の反映、元ファイルの保持、SHA-256、ビルド失敗、公開順序、アップロード失敗、再実行、権限エラーを検証する。GitHub CLIとdotnetのコマンドをテスト内で置き換え、実際の公開や本体起動は行わない。

`tests/browser-extension/background.test.mjs`はVMへ渡す前に改行をLFへ正規化し、WindowsのCRLF作業コピーでも起動処理の除去を確実に行う。これによりテスト中の予定外のhealth取得と再接続タイマーを防ぐ。
