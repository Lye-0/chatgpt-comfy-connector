# Connector Protocol v1

`comfy-connector/1` はChatGPTのCreative decisionをConnectorへ渡すための、Transport非依存なHandoff Protocolである。v0.1のTransportはManual Clipboardだが、Protocol modelは将来のBrowser Extension / External Providerからも再利用できる境界として扱う。

ProtocolはMCP tool surfaceではない。shell、filesystem操作、Workflow選択、Session状態変更をPayloadから実行しない。Workflow、Project / Chat、Iteration、許可action、slot schemaのSource of TruthはConnectorである。

## Connector Response

1回のResponseは次の2要素だけで構成する。

```text
Connector Response
├─ exactly 1 connector-command JSON block
└─ 0..N referenced COMFY_PAYLOAD blocks
```

説明文、別のcode fence、参照されないPayloadはResponse外ノイズとして許容しない。制御情報と短い構造値は小さなJSONへ置き、自由入力stringや複数行PromptはRaw Payloadへ置く。Base64や巨大なJSON stringは標準Transportにしない。

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

必須fieldは `protocol`、`action`、`handoff_id`、`session_id`、`slots`。`slots` はHandoff時に固定したschema snapshotに存在するaddressだけを含み、意図して変更する値だけを送る。Connectorは現在値と同一のslot、未知のslot、`null`、型・choice・range違反を拒否する。

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

## Slot transport

Handoff時のslot schema snapshotが、各slotのTransportを決める。

| Slot | Transport | JSON表現 |
|---|---|---|
| 自由入力 `STRING` / `TEXT` | `payload` | `{ "payload_id": "..." }` |
| file / unknown string-like | `payload`（安全側fallback） | `{ "payload_id": "..." }` |
| integer / number | `json` | JSON number |
| boolean | `json` | JSON boolean |
| enum / choice | `json` | choices内のJSON string |

H3固有addressはProtocolへハードコードしない。`list_workflow_slots` から得たaddress、label、type、current、choices、取得可能なrangeをsnapshotし、Response検証にも同じsnapshotを使用する。

Slot discoveryは `NotLoaded`、`Loading`、`Loaded`、`Failed` を区別する。MCP未接続や取得失敗は空schemaとして送らず、Handoff作成を停止する。正常に `Loaded` となった0 slot Workflowだけは、明示的な0件schemaとして扱える。

## Pending Handoff snapshot

ChatGPTへ渡す各Handoffは次を永続化する。

- `HandoffId`
- `SessionId`
- `BoundaryId`
- `AllowedActions`
- `WorkflowIdentity`
- Available slot schema
- `Iteration`
- `CreatedAt`

初回は原則 `generate`、成功Output後のReviewは `generate, complete` を許可する。新しいHandoffは古いpending snapshotを置換する。Responseは一時的なUI状態ではなくこのsnapshotと照合し、`handoff_id` 不一致をstale responseとして明示的に拒否する。`session_id` と現在のSession-bound Workflowも一致しなければならない。

## 検証順序

Importerは次の順序を保つ。

1. Raw Responseを保持する
2. `connector-command` blockが正確に1つか確認する
3. `System.Text.Json` でJSONをparseする
4. `protocol`、`action`、`handoff_id`、`session_id`、`AllowedActions` を検証する
5. payload referenceを収集し、supplied boundaryでRaw blockを解析する
6. Pending Handoffのslot schemaに対してaddress、transport、type、choice、range、changed-onlyを検証する
7. payloadを解決した `ResolvedSlots` を内部Preview modelへ渡す
8. 全検証成功後だけCOMMAND stageをCompletedへ進める

不正ResponseはAPPLYへ到達しない。ユーザー向けMessageと詳細Diagnosticsは分離し、DiagnosticsをPortable logへ残す。

## Handoff ContextとTimeline

BootstrapとReviewの各Handoffは、それ1件だけで新しいChatGPTが応答できるよう、role、response grammar、IDs、boundary、AllowedActions、Project / Chat / Workflow、Iteration、idea、該当Output、完全なslot schemaを含む。

Timelineは `CONNECTOR → CHATGPT`、`CHATGPT → COMFY`、`COMFY → CHATGPT` を維持する。ChatGPT → COMFYカードは解決済みPromptを主表示へ使い、Raw JSONを主役にしない。表示を短縮しても `HandoffMessage.Payload` と `ProtocolValidationResult.RawResponse` は破壊せず、Copyはconnector-commandと全Payloadを含むResponse全文を使う。

## Verification anchors

- `src/ChatGPTComfyConnector.Core/Services/ProtocolAndContext.cs` — envelope / JSON / payload / slot validation、snapshot factory、自己完結Context
- `src/ChatGPTComfyConnector.Core/Models/AppModels.cs` — Pending Handoff、slot transport、Raw / resolved command model
- `src/ChatGPTComfyConnector.Desktop/ViewModels/MainViewModel.cs` — discovery state、clipboard Handoff、State Machine / Timeline統合
- `tests/ChatGPTComfyConnector.Tests/ProtocolTests.cs` — Raw text、identity、boundary、slot、complete、self-contained Context
- `tests/ChatGPTComfyConnector.Tests/CreationPipelineStateMachineTests.cs` — allowed state、invalid command、replacement、Apply gating
