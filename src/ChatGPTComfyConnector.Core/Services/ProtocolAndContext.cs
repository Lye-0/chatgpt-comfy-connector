using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using ChatGPTComfyConnector.Core.Models;

namespace ChatGPTComfyConnector.Core.Services;

public static partial class ConnectorProtocol
{
    public const string Version = "comfy-connector/1";

    public static ProtocolValidationResult Parse(string raw, PendingHandoffSnapshot? pending)
    {
        var result = new ProtocolValidationResult { RawResponse = raw ?? string.Empty };
        if (string.IsNullOrWhiteSpace(raw))
        {
            result.Errors.Add("Connector Responseが空です。");
            return result;
        }
        if (pending is null)
        {
            result.Errors.Add("有効なPending Handoffがありません。先にChatGPTへHandoffをコピーしてください。");
            return result;
        }

        var envelope = ParseEnvelope(raw, pending, result.Errors);
        if (envelope.Json is null) return result;

        JsonObject? obj;
        try { obj = JsonNode.Parse(envelope.Json) as JsonObject; }
        catch (JsonException ex)
        {
            result.Errors.Add($"connector-command JSONを解析できません: {ex.Message}");
            return result;
        }
        if (obj is null)
        {
            result.Errors.Add("connector-commandのルートはJSON objectである必要があります。");
            return result;
        }

        var protocol = ReadRequiredString(obj, "protocol", result.Errors);
        var action = ReadRequiredString(obj, "action", result.Errors);
        var handoffId = ReadRequiredString(obj, "handoff_id", result.Errors);
        var sessionId = ReadRequiredString(obj, "session_id", result.Errors);
        if (!string.Equals(protocol, Version, StringComparison.Ordinal)) result.Errors.Add($"protocolは {Version} である必要があります。");
        if (action is not ("generate" or "complete")) result.Errors.Add("actionは generate または complete だけを指定できます。");
        if (!string.Equals(handoffId, pending.HandoffId, StringComparison.Ordinal)) result.Errors.Add("handoff_idが一致しません。この応答は以前のHandoff向けです。");
        if (!string.Equals(sessionId, pending.SessionId, StringComparison.Ordinal)) result.Errors.Add("session_idが現在の制作Sessionと一致しません。");
        if (action is not null && !pending.AllowedActions.Contains(action, StringComparer.Ordinal)) result.Errors.Add($"現在のHandoffではaction '{action}' は許可されていません。");

        var slots = obj["slots"] as JsonObject;
        var reason = ReadOptionalString(obj, "reason", result.Errors);
        if (action == "generate" && slots is null) result.Errors.Add("generateにはslots objectが必要です。");
        if (action == "complete" && string.IsNullOrWhiteSpace(reason)) result.Errors.Add("completeにはreasonが必要です。");
        if (reason?.Length > 1000) result.Errors.Add("reasonは1000文字以内です。");
        ValidateRootProperties(obj, action, result.Errors);

        slots ??= [];
        var resolved = new JsonObject();
        var referencedPayloads = new HashSet<string>(StringComparer.Ordinal);
        if (action == "generate") ValidateAndResolveSlots(slots, pending, envelope.Payloads, referencedPayloads, resolved, result.Errors);
        foreach (var payloadId in envelope.Payloads.Keys)
        {
            if (!referencedPayloads.Contains(payloadId)) result.Errors.Add($"参照されていないCOMFY_PAYLOADがあります: {payloadId}");
        }
        foreach (var payload in envelope.Payloads) result.ResolvedPayloads[payload.Key] = payload.Value;

        if (result.Errors.Count == 0)
        {
            result.Command = new ConnectorCommand
            {
                Protocol = protocol!, Action = action!, HandoffId = handoffId!, SessionId = sessionId!,
                Slots = (JsonObject)slots.DeepClone(), ResolvedSlots = resolved, Reason = reason,
            };
        }
        return result;
    }

    private static void ValidateAndResolveSlots(JsonObject slots, PendingHandoffSnapshot pending, IReadOnlyDictionary<string, string> payloads, ISet<string> referencedPayloads, JsonObject resolved, ICollection<string> errors)
    {
        var schema = pending.Slots.ToDictionary(slot => slot.Address, StringComparer.OrdinalIgnoreCase);
        foreach (var property in slots)
        {
            if (!schema.TryGetValue(property.Key, out var slot)) { errors.Add($"現在のHandoffに存在しないslotです: {property.Key}"); continue; }
            if (property.Value is null) { errors.Add($"slot値をnullにはできません: {property.Key}"); continue; }

            JsonNode? value;
            if (slot.Transport == SlotValueTransport.Payload)
            {
                if (!TryReadPayloadReference(property.Value, out var payloadId, errors, property.Key)) continue;
                referencedPayloads.Add(payloadId!);
                if (!payloads.TryGetValue(payloadId!, out var payloadText)) { errors.Add($"参照されたCOMFY_PAYLOADがありません: {payloadId}"); continue; }
                value = JsonValue.Create(payloadText);
            }
            else
            {
                if (property.Value is JsonObject reference && reference.ContainsKey("payload_id")) { errors.Add($"slot {property.Key} はJSON direct transportです。payload_idは使用できません。"); continue; }
                value = property.Value.DeepClone();
            }

            if (!ValidateValue(slot, value, errors)) continue;
            if (JsonNode.DeepEquals(slot.CurrentValue, value)) { errors.Add($"変更されていないslotは送信しないでください: {property.Key}"); continue; }
            resolved[property.Key] = value;
        }
    }

    private static bool TryReadPayloadReference(JsonNode node, out string? payloadId, ICollection<string> errors, string address)
    {
        payloadId = null;
        if (node is not JsonObject reference || reference.Count != 1 || reference["payload_id"] is not JsonValue idValue || !idValue.TryGetValue<string>(out payloadId))
        {
            errors.Add($"slot {address} は {{\"payload_id\":\"...\"}} 形式で指定してください。");
            return false;
        }
        if (!IsSafePayloadId(payloadId)) { errors.Add($"payload_idが不正です: {payloadId}"); return false; }
        return true;
    }

    private static bool ValidateValue(HandoffSlotSnapshot slot, JsonNode? value, ICollection<string> errors)
    {
        var valid = slot.Kind switch
        {
            WorkflowSlotType.String or WorkflowSlotType.File => IsString(value),
            WorkflowSlotType.Integer => IsInteger(value),
            WorkflowSlotType.Number => IsNumber(value),
            WorkflowSlotType.Boolean => IsBoolean(value),
            WorkflowSlotType.Enum => IsString(value),
            _ => value is JsonValue,
        };
        if (!valid) { errors.Add($"slot {slot.Address} の型が不正です。期待型: {slot.Type}"); return false; }
        if (slot.Kind == WorkflowSlotType.Enum && slot.Choices is { Count: > 0 } && !slot.Choices.Any(choice => JsonNode.DeepEquals(choice, value)))
        {
            errors.Add($"slot {slot.Address} の値は許可されたchoicesに含まれていません。");
            return false;
        }
        if (TryGetNumber(value, out var number))
        {
            if (slot.Minimum is not null && number < slot.Minimum) errors.Add($"slot {slot.Address} は最小値 {slot.Minimum.Value.ToString(CultureInfo.InvariantCulture)} 以上である必要があります。");
            if (slot.Maximum is not null && number > slot.Maximum) errors.Add($"slot {slot.Address} は最大値 {slot.Maximum.Value.ToString(CultureInfo.InvariantCulture)} 以下である必要があります。");
        }
        return true;
    }

    private static void ValidateRootProperties(JsonObject obj, string? action, ICollection<string> errors)
    {
        var allowed = action == "complete"
            ? new HashSet<string>(["protocol", "action", "handoff_id", "session_id", "reason"], StringComparer.Ordinal)
            : new HashSet<string>(["protocol", "action", "handoff_id", "session_id", "slots"], StringComparer.Ordinal);
        foreach (var property in obj) if (!allowed.Contains(property.Key)) errors.Add($"connector-commandに未定義のfieldがあります: {property.Key}");
    }

    private static ParsedEnvelope ParseEnvelope(string raw, PendingHandoffSnapshot pending, ICollection<string> errors)
    {
        var lines = EnumerateLines(raw).ToArray();
        var payloads = new Dictionary<string, string>(StringComparer.Ordinal);
        string? json = null;
        var commandCount = 0;
        for (var i = 0; i < lines.Length; i++)
        {
            var line = lines[i];
            if (string.IsNullOrWhiteSpace(line.Content)) continue;
            if (line.Content == "```connector-command")
            {
                commandCount++;
                var end = FindExactLine(lines, i + 1, "```");
                if (end < 0) { errors.Add("connector-command code fenceの終端がありません。"); break; }
                if (json is null) json = ExtractBody(raw, line, lines[end]);
                i = end;
                continue;
            }

            var startMatch = PayloadStartRegex().Match(line.Content);
            if (startMatch.Success)
            {
                var id = startMatch.Groups[1].Value;
                var boundary = startMatch.Groups[2].Value;
                if (!string.Equals(boundary, pending.BoundaryId, StringComparison.Ordinal)) errors.Add($"COMFY_PAYLOAD {id} のboundary_idが現在のHandoffと一致しません。");
                var expectedEnd = $"<<<END_COMFY_PAYLOAD:{id}:{boundary}>>>";
                var end = -1;
                for (var j = i + 1; j < lines.Length; j++)
                {
                    if (lines[j].Content == expectedEnd) { end = j; break; }
                    if (lines[j].Content.StartsWith("<<<COMFY_PAYLOAD:", StringComparison.Ordinal))
                    {
                        errors.Add($"COMFY_PAYLOAD {id} にnestedまたはoverlapしたmarkerがあります。"); end = j; break;
                    }
                }
                if (end < 0) { errors.Add($"COMFY_PAYLOAD {id} の終端markerがありません。"); break; }
                if (lines[end].Content == expectedEnd && !payloads.TryAdd(id, ExtractBody(raw, line, lines[end]))) errors.Add($"COMFY_PAYLOADが重複しています: {id}");
                i = end;
                continue;
            }

            if (line.Content.StartsWith("```", StringComparison.Ordinal)) errors.Add($"未対応または重複したcode fenceです: {line.Content}");
            else if (line.Content.StartsWith("<<<COMFY_PAYLOAD:", StringComparison.Ordinal) || line.Content.StartsWith("<<<END_COMFY_PAYLOAD:", StringComparison.Ordinal)) errors.Add($"COMFY_PAYLOAD markerが不正です: {line.Content}");
            else errors.Add("Connector Responseにはconnector-commandと参照されたCOMFY_PAYLOAD以外の説明文を含めないでください。");
        }
        if (commandCount != 1) errors.Add("Connector Responseにはconnector-command code fenceが正確に1つ必要です。");
        return new ParsedEnvelope(json, payloads);
    }

    private static IEnumerable<TextLine> EnumerateLines(string text)
    {
        var start = 0;
        while (start < text.Length)
        {
            var newline = text.IndexOf('\n', start);
            var next = newline < 0 ? text.Length : newline + 1;
            var contentEnd = newline < 0 ? text.Length : newline;
            if (contentEnd > start && text[contentEnd - 1] == '\r') contentEnd--;
            yield return new TextLine(start, next, text[start..contentEnd]);
            start = next;
        }
    }

    private static int FindExactLine(IReadOnlyList<TextLine> lines, int start, string content)
    {
        for (var i = start; i < lines.Count; i++) if (lines[i].Content == content) return i;
        return -1;
    }

    private static string ExtractBody(string raw, TextLine start, TextLine end)
    {
        var bodyStart = start.NextStart;
        var bodyEnd = end.Start;
        if (bodyEnd > bodyStart && raw[bodyEnd - 1] == '\n')
        {
            bodyEnd--;
            if (bodyEnd > bodyStart && raw[bodyEnd - 1] == '\r') bodyEnd--;
        }
        return raw[bodyStart..bodyEnd];
    }

    private static string? ReadRequiredString(JsonObject obj, string name, ICollection<string> errors)
    {
        var value = ReadOptionalString(obj, name, errors);
        if (string.IsNullOrWhiteSpace(value)) errors.Add($"{name}は必須の文字列です。");
        return value;
    }

    private static string? ReadOptionalString(JsonObject obj, string name, ICollection<string> errors)
    {
        var value = obj[name];
        if (value is null) return null;
        if (value is JsonValue jsonValue && jsonValue.TryGetValue<string>(out var text)) return text;
        errors.Add($"{name}は文字列である必要があります。");
        return null;
    }

    private static bool IsSafePayloadId(string? value) => value is { Length: > 0 and <= 64 } && PayloadIdRegex().IsMatch(value);
    private static bool IsString(JsonNode? value) => value is JsonValue v && v.TryGetValue<string>(out _);
    private static bool IsBoolean(JsonNode? value) => value is JsonValue v && v.TryGetValue<bool>(out _);
    private static bool IsInteger(JsonNode? value) => value is JsonValue v && (v.TryGetValue<int>(out _) || v.TryGetValue<long>(out _));
    private static bool IsNumber(JsonNode? value) => TryGetNumber(value, out _);
    private static bool TryGetNumber(JsonNode? value, out double number)
    {
        number = default;
        if (value is not JsonValue v) return false;
        if (v.TryGetValue<double>(out number)) return true;
        if (!v.TryGetValue<long>(out var integer)) return false;
        number = integer;
        return true;
    }

    [GeneratedRegex("^[A-Za-z0-9._-]{1,64}$", RegexOptions.CultureInvariant)] private static partial Regex PayloadIdRegex();
    [GeneratedRegex("^<<<COMFY_PAYLOAD:([A-Za-z0-9._-]{1,64}):([A-Za-z0-9._-]{1,128})>>>$", RegexOptions.CultureInvariant)] private static partial Regex PayloadStartRegex();
    private sealed record ParsedEnvelope(string? Json, IReadOnlyDictionary<string, string> Payloads);
    private sealed record TextLine(int Start, int NextStart, string Content);
}

public static class PendingHandoffFactory
{
    public static PendingHandoffSnapshot Create(CreationSession session, IEnumerable<WorkflowSlot> slots, params string[] allowedActions)
        => new()
        {
            SessionId = session.Id,
            WorkflowIdentity = session.BoundWorkflow?.RelativePath ?? string.Empty,
            Iteration = session.CurrentIteration,
            AllowedActions = allowedActions.Distinct(StringComparer.Ordinal).ToList(),
            Slots = slots.Select(slot => new HandoffSlotSnapshot
            {
                Address = slot.Address, Label = slot.Label, Type = slot.Type, CurrentValue = slot.CurrentValue?.DeepClone(),
                Choices = slot.Choices?.DeepClone() as JsonArray, Minimum = slot.Minimum, Maximum = slot.Maximum,
                Transport = slot.Kind is WorkflowSlotType.String or WorkflowSlotType.File or WorkflowSlotType.Unknown ? SlotValueTransport.Payload : SlotValueTransport.Json,
            }).ToList(),
        };
}

public static class ConnectorContextBuilder
{
    public static string BuildBootstrap(CreationSession session, PendingHandoffSnapshot handoff) => Build(session, handoff, null);
    public static string BuildResult(CreationSession session, SessionIteration iteration, PendingHandoffSnapshot handoff) => Build(session, handoff, iteration);

    private static string Build(CreationSession session, PendingHandoffSnapshot handoff, SessionIteration? iteration)
    {
        var sb = new StringBuilder();
        sb.AppendLine("# ChatGPT Comfy Connector Handoff");
        sb.AppendLine("You are the creative director and iteration partner for ChatGPT Comfy Connector.");
        sb.AppendLine("This Handoff is self-contained; do not rely on earlier chat context.");
        sb.AppendLine();
        sb.AppendLine("## Response contract (strict)");
        sb.AppendLine($"Protocol: {ConnectorProtocol.Version}");
        sb.AppendLine("Return exactly one Connector Response.");
        sb.AppendLine("A Connector Response consists of exactly one `connector-command` JSON block and zero or more referenced COMFY_PAYLOAD blocks. Return no prose outside it.");
        sb.AppendLine($"handoff_id: {handoff.HandoffId}");
        sb.AppendLine($"session_id: {handoff.SessionId}");
        sb.AppendLine($"boundary_id: {handoff.BoundaryId}");
        sb.AppendLine($"Payload boundary: {handoff.BoundaryId}");
        sb.AppendLine($"Allowed actions for this Handoff: {string.Join(", ", handoff.AllowedActions)}");
        sb.AppendLine("Echo handoff_id and session_id exactly. Use only listed slot addresses and include only changed slots.");
        sb.AppendLine("Never invent slot addresses or filesystem paths. Connector owns Workflow, Session, Project, Chat and iteration state.");
        sb.AppendLine("String/free-form/multiline slots must use payload_id. Number, boolean and enum slots use direct JSON values.");
        sb.AppendLine("Every referenced payload must have exactly one block; do not add unreferenced blocks. Preserve the exact boundary_id.");
        sb.AppendLine();
        sb.AppendLine("Generate response grammar:");
        sb.AppendLine("```connector-command");
        sb.AppendLine($"{{\"protocol\":\"{ConnectorProtocol.Version}\",\"action\":\"generate\",\"handoff_id\":\"<echo supplied handoff_id>\",\"session_id\":\"<echo supplied session_id>\",\"slots\":{{\"<payload-string-slot-address>\":{{\"payload_id\":\"prompt-main\"}},\"<numeric-slot-address>\":5}}}}");
        sb.AppendLine("```");
        sb.AppendLine("<<<COMFY_PAYLOAD:prompt-main:<supplied-boundary>>>");
        sb.AppendLine("<raw UTF-8 text>");
        sb.AppendLine("<<<END_COMFY_PAYLOAD:prompt-main:<supplied-boundary>>>");
        sb.AppendLine("Complete response grammar:");
        sb.AppendLine("```connector-command");
        sb.AppendLine($"{{\"protocol\":\"{ConnectorProtocol.Version}\",\"action\":\"complete\",\"handoff_id\":\"<echo supplied handoff_id>\",\"session_id\":\"<echo supplied session_id>\",\"reason\":\"<concise reason>\"}}");
        sb.AppendLine("```");
        sb.AppendLine();
        sb.AppendLine("## Current creation context");
        sb.AppendLine($"Project: {session.ProjectLabel}");
        sb.AppendLine($"Chat: {session.ChatLabel}");
        sb.AppendLine($"Workflow: {session.BoundWorkflow?.RelativePath ?? "(not selected)"}");
        sb.AppendLine($"Maximum iterations: {session.MaximumIterations}");
        sb.AppendLine($"Current iteration: {session.CurrentIteration}");
        sb.AppendLine("Original idea:");
        sb.AppendLine(session.OriginalIdea);
        if (iteration is not null)
        {
            sb.AppendLine();
            sb.AppendLine("## Output under review");
            sb.AppendLine($"Iteration: {iteration.Number}");
            sb.AppendLine($"Status: {iteration.Status}");
            sb.AppendLine($"Prompt: {iteration.Prompt}");
            sb.AppendLine("Outputs (local metadata; do not claim you read these files unless the user attaches them):");
            foreach (var output in iteration.Outputs) sb.AppendLine($"- {output.FileName} ({output.Type}) | {output.FullPath} | {(output.IsMissing ? "Missing" : "Available")}");
            sb.AppendLine("Evaluate user-attached media. Use generate for a changed next iteration, or complete only if allowed and the goal is met.");
        }
        sb.AppendLine();
        sb.AppendLine("## Available slot schema snapshot");
        if (handoff.Slots.Count == 0) sb.AppendLine("(Successfully loaded: 0 slots. A generate response must use an empty slots object.)");
        foreach (var slot in handoff.Slots)
        {
            var choices = slot.Choices is null ? string.Empty : $" | choices={slot.Choices.ToJsonString()}";
            var range = slot.Minimum is null && slot.Maximum is null ? string.Empty : $" | range={slot.Minimum?.ToString(CultureInfo.InvariantCulture) ?? "-∞"}..{slot.Maximum?.ToString(CultureInfo.InvariantCulture) ?? "+∞"}";
            sb.AppendLine($"- {slot.Address} | label={slot.Label} | type={slot.Type} | current={slot.CurrentValue?.ToJsonString() ?? "null"} | transport={slot.Transport.ToString().ToLowerInvariant()}{choices}{range}");
        }
        return sb.ToString();
    }
}
