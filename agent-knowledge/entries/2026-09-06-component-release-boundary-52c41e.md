---
id: rm-20260906-component-release-boundary
topic: component-releases
type: decision
status: active
maturity: candidate
created: 2026-09-06
last_verified: 2026-09-06
source_commit: "0d0e6b6"
related_files:
  - .github/workflows/release-desktop.yml
  - .github/workflows/release-collector.yml
  - scripts/release-common.ps1
  - scripts/publish-win-x64.ps1
  - scripts/publish-collector.ps1
  - scripts/publish-github-release.ps1
  - tests/distribution/release-scripts.tests.ps1
  - docs/releases.md
tags:
  - github-release
  - tags
  - collector
  - versioning
supersedes: null
promoted_to: null
---

# 本体とコレクタのリリース所有範囲をタグとZIPで分離する

## Conclusion

本体とコレクタは独立したGitHub Release系列として扱う。本体は`desktop-v<SemVer>`、コレクタは`collector-v<SemVer>`だけで起動し、各コンポーネントのZIPを作る。配布物のバージョンはタグを正とし、ソースのバージョンが同じであることを要求しない。GitHubのLatestはリポジトリに1つなので、コレクタ公開時は`--latest=false`を維持する。

## Scope

Applicable:
- リリースワークフロー、ZIPの構成、タグとバージョン、公開導線の変更。
- 本体・コレクタを片方ずつ更新する配布作業。

Do not apply:
- Bridgeプロトコルの互換性判断をリリース番号の一致で代用する用途。
- ローカルで展開済みのコレクタの読み込み先変更。識別と再ペアリングの境界は別途確認する。

## Evidence

- ユーザーは本体とコレクタをGitHub Releasesで配布し、発火タグを分け、利用者に開発者モードで読み込んでもらう方針を指定した。
- `release-desktop.yml`と`release-collector.yml`: 対象タグ、対象テスト、パッケージ作成、公開を分離する。
- `publish-collector.ps1`: manifestをZIP直下へ配置し、一時コピーの`version`と`version_name`にタグの数値部分とSemVer全体を反映する。
- `publish-github-release.ps1`: 対象タグ・ファイル名・SHA-256を先に確認し、新規Releaseを下書き→添付→公開の順に処理する。コレクタでLatestを上書きしない。
- `release-scripts.tests.ps1`: 実際のZIP作成と、コマンド置換による公開順序・失敗・再実行・タグ分離の検証。実際のGitHub公開は行わない。
- `docs/releases.md`が現行配布仕様を所有する。

## Verification

1. 両workflowのタグ条件が重複せず、参照するスクリプト・テストがGit管理対象に含まれることを確認する。
2. 配布スクリプトのテストとactionlintを実行する。
3. 本体とコレクタのZIP内容、バージョン、SHA-256をそれぞれ確認する。
4. 新規公開と再実行で、別系列のReleaseやLatest表示を変更しないことを確認する。
