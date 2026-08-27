# Connector Protocol v1

`comfy-connector/1` はChatGPTのCreative decisionをConnectorへ渡すための、Transport非依存なHandoff Protocolである。v0.1のTransportはManual Clipboardだが、Protocol modelは将来のBrowser Extension / External Providerからも再利用できる境界として扱う。

ProtocolはMCP tool surfaceではない。shell、filesystem操作、Workflow選択、Session状態変更をPayloadから実行しない。Workflow、Project / Chat、Iteration、許可action、slot schemaのSource of TruthはConnectorである。

## Connector Response

1回のResponseは次の2要素で構成する。Commandは従来どおり厳格に1つだけだが、
ChatGPTのコードブロックCopyで言語名が落ちる／`json`になる場合と、説明文付きの
raw JSONになる場合を受理できる。

```text
Connector Response
├─ exactly 1 JSON object
│  ├─ preferred: `connector-command` code fence
│  ├─ accepted: `json` (または言語名なし) code fence
│  └─ accepted: fence-less raw JSON, optionally surrounded by short explanation
└─ 0..N referenced COMFY_PAYLOAD blocks
```

許可されない言語のcode fence、複数のJSON object、参照されないPayloadは拒否する。
fence-less形式に限り、JSON objectを囲む短い説明文を許容する。制御情報と短い
構造値は小さなJSONへ置き、自由入力stringや複数行PromptはRaw Payloadへ置く。
Base64や巨大なJSON stringは標準Transportにしない。

### generate

```connector-command
{
  "protocol": "comfy-connector/1",
  "action": "generate",
  "handoff_id": "<Connector supplied id>",
  "session_id": "<current Creation Session id>",
  "slots": {
    "<payload-string-slot-address>": {
      "payload_id": "prompt-main"
    },
    "<numeric-slot-address>": 5
  }
}
```

必須fieldは `protocol`、`action`、`handoff_id`、`session_id`、`slots`。`slots` はHandoff時に固定したschema snapshotで `Writable` と判定されたaddressだけを含み、意図して変更する値だけを送る。ConnectorはReadOnly / Hidden、現在値と同一のslot、未知のslot、`null`、型・choice・range違反を拒否する。

### complete

```connector-command
{
  "protocol": "comfy-connector/1",
  "action": "complete",
  "handoff_id": "<Connector supplied id>",
  "session_id": "<current Creation Session id>",
  "reason": "<concise completion reason>"
}
```

必須fieldは `protocol`、`action`、`handoff_id`、`session_id`、`reason`。`complete` にPayloadは使わない。初回Handoffでは許可せず、成功Output後のReviewでのみ `CreationPipelineStateMachine` が受理する。

## COMFY_PAYLOAD

```text
<<<COMFY_PAYLOAD:<payload_id>:<boundary_id>>>
<raw UTF-8 text>
<<<END_COMFY_PAYLOAD:<payload_id>:<boundary_id>>>
```

Start / End markerは完全一致する独立行である。`payload_id` は `[A-Za-z0-9._-]` の1〜64文字。`boundary_id` はConnectorがHandoffごとに `Guid.NewGuid().ToString("N")` 相当で生成し、ChatGPTは完全一致でechoする。

本文はRaw slot valueであり、JSON、Markdown、triple-backtick、quotes、braces、backslash、日本語、Unicode、改行をProtocol syntaxや命令として再解釈しない。Parserはmarkerを分離する1行分以外へ `Trim` 系処理を行わない。別boundaryのEND風文字列は本文のまま保持する。

同じPayloadを複数slotから参照してよいが、Payload blockはResponse内に1つだけ置く。参照欠落、重複ID、無効ID、boundary違い、終端欠落、orphan marker、未参照block、nested / overlapping blockを拒否する。

## Slot exposure policyとtransport

MCPが発見したslot、Connector UIでユーザーが編集できるslot、ChatGPTがCreative Commandで変更できるslotは別の概念である。`ChatGptSlotPolicy` はaddress固有のallowlistではなく、label、type、choices等のmetadataから `Writable` / `ReadOnly` / `Hidden` を判定する。

- prompt、negative / motion / audio prompt、seed、duration / length、fps、width / height、aspect ratio、megapixels、steps、denoise等、明確なCreative ControlだけをWritable候補とする。
- filename / output path、model / checkpoint / UNet / VAE / CLIP、device、internal expression / formula等はHiddenとする。
- 未知・曖昧なslotはHiddenとする。
- COMBO / enum / dynamic comboはchoicesを取得できた場合だけWritableになり得る。choices不明ならReadOnlyであり、現在値をallowed choiceの代用にしない。

ExposureとTransportは独立している。たとえば `filename_prefix` はpayload transport可能でもChatGPT writableではない。Handoff時のslot schema snapshotが、各slotのExposure、理由、Transport、current、choices、rangeを固定する。

| Slot | Transport | JSON表現 |
|---|---|---|
| 自由入力 `STRING` / `TEXT` | `payload` | `{ "payload_id": "..." }` |
| file / unknown string-like | `payload`（Transport上のfallback） | `{ "payload_id": "..." }`。通常はHidden |
| integer / number | `json` | JSON number |
| boolean | `json` | JSON boolean |
| enum / choice | `json` | choices内のJSON string |

H3固有addressはProtocolへハードコードしない。`list_workflow_slots` から得たaddress、label、type、current、choices、取得可能なrangeへPolicyを適用してsnapshotし、Response検証にも同じsnapshotを使用する。Slot addressは `OrdinalIgnoreCase` でWorkflow Context内の一意キーとして扱う。同一addressの同一schemaレコードは発見段階で1件へ正規化し、内容が異なる同一addressはschema conflictとして拒否する。Handoff本文にはWritable schemaだけを掲載するが、Pending Handoffは発見slotのPolicy結果を保持し、手書きされたHidden / ReadOnly addressも拒否する。

Slot discoveryは `NotLoaded`、`Loading`、`Loaded`、`Failed` を区別する。MCP未接続や取得失敗は空schemaとして送らず、Handoff作成を停止する。正常に `Loaded` となった0 slot Workflowだけは、明示的な0件schemaとして扱える。Workflow選択や再接続に伴う非同期の古い応答は、現在の読み込み世代と一致しない限りUIのslot collectionへ反映しない。

## Pending Handoff snapshot

ChatGPTへ渡す各Handoffは次を永続化する。

- `Purpose` (`Bootstrap` or `Review`; older snapshots infer Review from `complete` permission)
- `HandoffId`
- `SessionId`
- `BoundaryId`
- `AllowedActions`
- `WorkflowIdentity`
- Project / Chat provider and context keys
- Project / Chat labels
- Slot schemaとChatGPT exposure / writable policy（addressは一意、競合は発行不可）
- `Iteration`
- `CreatedAt`

初回は原則 `generate`、成功Output後のReviewは `generate, complete` を許可する。発行済みPending Handoffは、同じWorkflow・slot schema・Iteration・Kickoff instructionの間はimmutableであり、再コピーや接続状態の更新では置換しない。Workflow、Project / Chat、Kickoff instructionなどの制作Contextが明示的に変更されて再送する場合だけ、新しいsnapshotとIDを発行する。Responseは一時的なUI状態ではなくこのsnapshotと照合し、`handoff_id` 不一致をstale responseとして明示的に拒否する。`session_id` と現在のSession-bound Workflowも一致しなければならない。

## 検証順序

Importerは次の順序を保つ。

1. Raw Responseを保持する
2. 許可された表現からJSON objectを安全に1つ抽出する（braces inside strings／nested object対応）
3. `System.Text.Json` で抽出したJSONをparseする
4. `protocol`、`action`、`handoff_id`、`session_id`、`AllowedActions` を検証する
5. payload referenceを収集し、supplied boundaryでRaw blockを解析する
6. Pending Handoffのslot schemaに対して重複／競合addressがないこと、およびwritable、address、transport、type、choice、range、changed-onlyを検証する
7. payloadを解決した `ResolvedSlots` を内部Preview modelへ渡す
8. 全検証成功後だけCOMMAND stageをCompletedへ進める

不正ResponseはAPPLYへ到達しない。ユーザー向けMessageと詳細Diagnosticsは分離し、DiagnosticsをPortable logへ残す。

## Handoff ContextとTimeline

BootstrapとReviewの各Handoffは、選択したChatGPT会話へ貼り付けて使えるよう、role、そのHandoffで許可されたactionだけのresponse grammar、IDs、boundary、AllowedActions、Project / Chat / Workflow、Iteration、任意のKickoff instruction、該当Output、Writable slot schemaを含む。既存会話のメッセージがある場合はそれを制作文脈として利用し、Kickoff instructionがある場合は追加指示として優先する。新規Chatで履歴がない場合も、Workflow / slot schemaなどのHandoff情報だけで動作できる。説明用current / choicesは人間とLLMが読めるUnicodeのまま出力し、JSON / HTML / Markdown escapeを重ねない。Protocol fenceとPayload markerは実Clipboard上でもescapeしない。

Review HandoffのOutputはChatGPT向けのローカル限定メタデータへ縮約する。ファイル名、MIME type、`local_only=true`、必要に応じて`available`やサイズなどの非機密情報だけを掲載し、絶対パス、ComfyUIのインストール先、Windowsユーザーディレクトリ、Connector内部の保存先は掲載しない。実ファイルパスはConnector内部の`OutputArtifact`に保持し、Output Viewer、HISTORY、OPENでのみ使用する。ChatGPTはユーザーが実ファイルを会話へ添付した場合に限り、そのメディアをレビューしたと主張できる。

Timelineは `CONNECTOR → CHATGPT`、`CHATGPT → COMFY`、`COMFY → CHATGPT` を維持する。ChatGPT → COMFYカードは解決済みPromptを主表示へ使い、Raw JSONを主役にしない。表示を短縮しても `HandoffMessage.Payload` と `ProtocolValidationResult.RawResponse` は破壊せず、Copyはconnector-commandと全Payloadを含むResponse全文を使う。

## Verification anchors

- `src/ChatGPTComfyConnector.Core/Services/ProtocolAndContext.cs` — envelope / JSON / payload / slot validation、snapshot factory、既存会話対応Context
- `src/ChatGPTComfyConnector.Core/Models/AppModels.cs` — Pending Handoff、slot transport、Raw / resolved command model
- `src/ChatGPTComfyConnector.Desktop/ViewModels/MainViewModel.cs` — discovery state、clipboard Handoff、State Machine / Timeline統合
- `tests/ChatGPTComfyConnector.Tests/ProtocolTests.cs` — Raw text、identity、boundary、slot、complete、既存会話対応のContext
- `tests/ChatGPTComfyConnector.Tests/CreationPipelineStateMachineTests.cs` — allowed state、invalid command、replacement、Apply gating
