# Connector Protocol v1

The protocol is intentionally high-level. It is not an MCP tool surface and cannot execute shell commands.

## Generate

```json
{
  "protocol": "comfy-connector/1",
  "action": "generate",
  "parameters": {
    "105/104.prompt": "A rainy Tokyo night"
  }
}
```

`parameters` keys must be present in the currently selected Workflow's `list_workflow_slots` result. Values are applied only after a user presses `APPLY` or `APPLY + GENERATE`. The command may include a relative `workflow` expectation for binding validation; it cannot select an arbitrary absolute path.

## Complete

```json
{
  "protocol": "comfy-connector/1",
  "action": "complete",
  "reason": "The attached result meets the brief."
}
```

`complete` changes the current Session to `Completed`, preserves every Iteration and output, and does not call ComfyUI. A completed Session can be resumed explicitly by the user.

## Parsing and safety

The importer accepts raw JSON and one `json`/`connector-command` Markdown fence. Multiple ambiguous commands, unknown actions, absolute paths, traversal, unknown slot keys, null values, and unsupported protocol versions are rejected with a user-facing validation message.
