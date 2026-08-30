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
        // Validate the issued schema for every response, including
        // `complete`. A duplicate PendingHandoff schema is corrupted state and
        // must not slip through merely because that action has no slot values.
        SlotSchemaPolicy.TryBuildSnapshotDictionary(pending.Slots, out var schema, result.Errors);
        if (action == "generate") ValidateAndResolveSlots(slots, schema, envelope.Payloads, referencedPayloads, resolved, result.Errors);
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

    private static void ValidateAndResolveSlots(JsonObject slots, IReadOnlyDictionary<string, HandoffSlotSnapshot> schema, IReadOnlyDictionary<string, string> payloads, ISet<string> referencedPayloads, JsonObject resolved, ICollection<string> errors)
    {
        // The schema dictionary was built by SlotSchemaPolicy before this
        // method is called. Do not use ToDictionary here: PendingHandoff is
        // persisted data and duplicate addresses must remain validation errors,
        // not unhandled ArgumentExceptions.
        foreach (var property in slots)
        {
            if (!schema.TryGetValue(property.Key, out var slot)) { errors.Add($"現在のHandoffに存在しないslotです: {property.Key}"); continue; }
            if (!slot.IsWritableByChatGpt) { errors.Add($"slot {property.Key} は現在のHandoffでChatGPTから変更できません。"); continue; }
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
        if (slot.Kind == WorkflowSlotType.Enum && slot.Choices is not { Count: > 0 })
        {
            errors.Add($"slot {slot.Address} は許可されたchoicesを取得できないため変更できません。");
            return false;
        }
        if (slot.Kind == WorkflowSlotType.Enum && !slot.Choices!.Any(choice => JsonNode.DeepEquals(choice, value)))
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
        var payloadSpans = new List<(int StartLine, int EndLine)>();

        // Payload blocks are parsed first and removed from the command scan.
        // This keeps arbitrary braces and Markdown fences inside a raw payload
        // from being mistaken for a second command object.
        for (var i = 0; i < lines.Length; i++)
        {
            var line = lines[i];
            if (string.IsNullOrWhiteSpace(line.Content)) continue;

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
                if (end < 0)
                {
                    errors.Add($"COMFY_PAYLOAD {id} の終端markerがありません。");
                    payloadSpans.Add((i, lines.Length - 1));
                    break;
                }

                if (lines[end].Content == expectedEnd && !payloads.TryAdd(id, ExtractBody(raw, line, lines[end]))) errors.Add($"COMFY_PAYLOADが重複しています: {id}");
                payloadSpans.Add((i, end));
                i = end;
                continue;
            }

            if (line.Content.StartsWith("<<<COMFY_PAYLOAD:", StringComparison.Ordinal) || line.Content.StartsWith("<<<END_COMFY_PAYLOAD:", StringComparison.Ordinal)) errors.Add($"COMFY_PAYLOAD markerが不正です: {line.Content}");
        }

        var commandText = RemoveLineSpans(raw, lines, payloadSpans);
        var commandLines = EnumerateLines(commandText).ToArray();
        var fenceBodies = new List<string>();
        var outsideFence = new StringBuilder();
        var hasCodeFence = false;

        for (var i = 0; i < commandLines.Length; i++)
        {
            var line = commandLines[i];
            if (!line.Content.StartsWith("```", StringComparison.Ordinal))
            {
                outsideFence.AppendLine(line.Content);
                continue;
            }

            hasCodeFence = true;
            var language = line.Content[3..].Trim();
            var end = FindExactLine(commandLines, i + 1, "```");
            if (end < 0)
            {
                errors.Add($"{(string.IsNullOrEmpty(language) ? "JSON" : language)} code fenceの終端がありません。");
                break;
            }

            if (language is not ("" or "connector-command" or "json"))
            {
                errors.Add($"未対応のConnector Response code fenceです: {line.Content}");
            }
            else
            {
                fenceBodies.Add(ExtractBody(commandText, line, commandLines[end]));
            }

            i = end;
        }

        string? json = null;
        if (hasCodeFence)
        {
            // The fenced forms retain the original strict envelope boundary:
            // only the command fence and parsed Payload blocks may be present
            // outside it.  The more permissive explanatory-text form is
            // reserved for fence-less raw JSON below.
            if (!string.IsNullOrWhiteSpace(outsideFence.ToString()))
            {
                errors.Add("code fence外には説明文を含めず、JSON objectまたは許可されたPayloadだけを指定してください。");
            }

            if (fenceBodies.Count != 1)
            {
                errors.Add("Connector Responseには許可されたJSON code fenceを1つだけ指定してください。");
            }

            var candidates = fenceBodies
                .SelectMany(body => ExtractJsonCandidates(body).Select(candidate => (Body: body, Candidate: candidate)))
                .ToList();
            if (candidates.Count == 1)
            {
                var candidate = candidates[0].Candidate;
                // A fenced command is intentionally strict: the allowed fence
                // contains one JSON object and nothing else.  Explanatory
                // prose is supported in the fence-less form below.
                var body = candidates[0].Body;
                if (!IsOnlyWhitespace(body[..candidate.Start]) || !IsOnlyWhitespace(body[candidate.EndExclusive..]))
                {
                    errors.Add("Connector ResponseのJSON code fenceにはJSON object以外の本文を含めないでください。");
                }
                else
                {
                    json = candidate.Json;
                }
            }
            else if (candidates.Count == 0)
            {
                errors.Add("許可されたJSON code fenceにJSON objectがありません。");
            }
            else
            {
                errors.Add("Connector ResponseにはJSON objectを1つだけ指定してください。");
            }
        }
        else
        {
            // ChatGPT may copy a raw object with a short explanation around
            // it.  The balanced scanner understands nested objects and braces
            // inside JSON strings, while still rejecting multiple candidates.
            var candidates = ExtractJsonCandidates(commandText);
            if (candidates.Count == 1)
            {
                json = candidates[0].Json;
            }
            else if (candidates.Count == 0)
            {
                errors.Add("Connector ResponseからJSON objectを検出できませんでした。");
            }
            else
            {
                errors.Add("Connector ResponseにはJSON objectを1つだけ指定してください。");
            }
        }

        return new ParsedEnvelope(json, payloads);
    }

    private static string RemoveLineSpans(string raw, IReadOnlyList<TextLine> lines, IReadOnlyCollection<(int StartLine, int EndLine)> spans)
    {
        if (spans.Count == 0) return raw;

        var builder = new StringBuilder(raw.Length);
        var cursor = 0;
        foreach (var span in spans.OrderBy(item => item.StartLine))
        {
            if (span.StartLine < 0 || span.EndLine < span.StartLine || span.StartLine >= lines.Count) continue;
            var start = lines[span.StartLine].Start;
            var endLine = Math.Min(span.EndLine, lines.Count - 1);
            var end = lines[endLine].NextStart;
            if (start > cursor) builder.Append(raw[cursor..start]);
            cursor = Math.Max(cursor, end);
        }

        if (cursor < raw.Length) builder.Append(raw[cursor..]);
        return builder.ToString();
    }

    private static List<JsonCandidate> ExtractJsonCandidates(string text)
    {
        var candidates = new List<JsonCandidate>();
        for (var start = 0; start < text.Length; start++)
        {
            if (text[start] != '{' || !TryReadBalancedObject(text, start, out var endExclusive)) continue;

            var candidate = text[start..endExclusive];
            try
            {
                if (JsonNode.Parse(candidate) is JsonObject)
                {
                    candidates.Add(new JsonCandidate(start, endExclusive, candidate));
                }
            }
            catch (JsonException)
            {
                // A brace in surrounding prose is not a command candidate;
                // continue scanning for the single valid object.
            }

            // Skip the complete balanced object so nested JSON properties are
            // not counted as separate commands.
            start = endExclusive - 1;
        }

        return candidates;
    }

    private static bool TryReadBalancedObject(string text, int start, out int endExclusive)
    {
        endExclusive = start;
        var depth = 0;
        var inString = false;
        var escaped = false;
        for (var index = start; index < text.Length; index++)
        {
            var ch = text[index];
            if (inString)
            {
                if (escaped) escaped = false;
                else if (ch == '\\') escaped = true;
                else if (ch == '"') inString = false;
                continue;
            }

            if (ch == '"') { inString = true; continue; }
            if (ch == '{') { depth++; continue; }
            if (ch != '}' || --depth != 0) continue;

            endExclusive = index + 1;
            return true;
        }

        return false;
    }

    private static bool IsOnlyWhitespace(string text)
        => text.All(char.IsWhiteSpace);

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
    private sealed record JsonCandidate(int Start, int EndExclusive, string Json);
    private sealed record TextLine(int Start, int NextStart, string Content);
}

public static class PendingHandoffFactory
{
    public static PendingHandoffSnapshot Create(CreationSession session, IEnumerable<WorkflowSlot> slots, params string[] allowedActions)
        => CreateCore(
            session,
            slots,
            allowedActions.Contains("complete", StringComparer.Ordinal) ? PendingHandoffPurpose.Review : PendingHandoffPurpose.Bootstrap,
            allowedActions);

    public static PendingHandoffSnapshot CreateReview(CreationSession session, IEnumerable<WorkflowSlot> slots, params string[] allowedActions)
        => CreateCore(session, slots, PendingHandoffPurpose.Review, allowedActions);

    public static PendingHandoffSnapshot CreateResume(CreationSession session, IEnumerable<WorkflowSlot> slots)
        => CreateCore(session, slots, PendingHandoffPurpose.Resume, ["generate"]);

    public static PendingHandoffSnapshot CreateGenerationResult(CreationSession session, IEnumerable<WorkflowSlot> slots, params string[] allowedActions)
        => CreateCore(session, slots, PendingHandoffPurpose.GenerationResult, allowedActions);

    private static PendingHandoffSnapshot CreateCore(CreationSession session, IEnumerable<WorkflowSlot> slots, PendingHandoffPurpose purpose, IEnumerable<string> allowedActions)
        => new()
        {
            Purpose = purpose,
            SessionId = session.Id,
            WorkflowIdentity = session.BoundWorkflow?.RelativePath ?? string.Empty,
            ContextProviderId = session.EffectiveContextProviderId,
            ProjectContextKey = session.EffectiveProjectContextKey ?? string.Empty,
            ChatContextKey = session.EffectiveChatContextKey ?? string.Empty,
            ProjectLabel = session.ProjectLabel,
            ChatLabel = session.ChatLabel,
            KickoffInstruction = session.OriginalIdea,
            Iteration = session.CurrentIteration,
            AllowedActions = allowedActions.Distinct(StringComparer.Ordinal).ToList(),
            Slots = SlotSchemaPolicy.CreateSnapshots(slots).ToList(),
        };
}

public static class ChatGptSlotPolicy
{
    private static readonly string[] CreativeTokens =
    [
        "prompt", "seed", "duration", "length", "fps", "width", "height", "aspectratio", "megapixel", "steps", "denoise",
    ];

    private static readonly string[] ProtectedTokens =
    [
        "filename", "filepath", "outputpath", "directory", "folder", "checkpoint", "ckpt", "model", "unet", "vae", "clipname",
        "weightdtype", "device", "expression", "formula",
    ];

    public static HandoffSlotSnapshot CreateSnapshot(WorkflowSlot slot)
    {
        var transport = slot.Kind is WorkflowSlotType.String or WorkflowSlotType.File or WorkflowSlotType.Unknown
            ? SlotValueTransport.Payload
            : SlotValueTransport.Json;
        var (exposure, reason) = Evaluate(slot);
        return new HandoffSlotSnapshot
        {
            Address = slot.Address,
            Label = slot.Label,
            Type = slot.Type,
            CurrentValue = slot.CurrentValue?.DeepClone(),
            Choices = slot.Choices?.DeepClone() as JsonArray,
            Minimum = slot.Minimum,
            Maximum = slot.Maximum,
            Transport = transport,
            Exposure = exposure,
            PolicyReason = reason,
        };
    }

    public static (ChatGptSlotExposure Exposure, string Reason) Evaluate(WorkflowSlot slot)
    {
        var semantic = Normalize($"{slot.Label} {slot.Address.Split('.').LastOrDefault()}");
        if (ProtectedTokens.Any(semantic.Contains)) return (ChatGptSlotExposure.Hidden, "workflow implementation or filesystem setting");
        if (!CreativeTokens.Any(semantic.Contains)) return (ChatGptSlotExposure.Hidden, "not recognized as a creative control");
        if (slot.Kind == WorkflowSlotType.Enum && slot.Choices is not { Count: > 0 }) return (ChatGptSlotExposure.ReadOnly, "allowed choices unavailable");
        if (slot.Kind is WorkflowSlotType.Unknown or WorkflowSlotType.File) return (ChatGptSlotExposure.Hidden, "unsupported or unsafe value type");
        return (ChatGptSlotExposure.Writable, "recognized creative control");
    }

    private static string Normalize(string value)
        => new(value.Where(char.IsLetterOrDigit).Select(char.ToLowerInvariant).ToArray());
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
        sb.AppendLine("This Handoff is designed to be pasted into the selected ChatGPT conversation.");
        sb.AppendLine("When earlier messages are available, use that conversation history as the production context.");
        sb.AppendLine("Use that production context to create detailed generation instructions for the selected Workflow.");
        sb.AppendLine("If a Kickoff instruction is provided below, treat it as an additional instruction and prioritize it when it clarifies the requested direction.");
        sb.AppendLine("If the Kickoff instruction is blank, begin from the existing conversation context.");
        sb.AppendLine("If this is a new Chat with no earlier messages, use the Workflow, slot schema, and other context below as the production basis.");
        if (handoff.Purpose == PendingHandoffPurpose.Resume)
        {
            sb.AppendLine("The user explicitly resumed a previously completed creation. Treat the latest attached result as the baseline and propose one improved next generation.");
            sb.AppendLine("This Resume Handoff permits generate only; do not return complete for this first resumed iteration.");
        }
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
        sb.AppendLine("Echo handoff_id and session_id exactly. Use only slot addresses explicitly listed as writable and include only changed slots.");
        sb.AppendLine("Never invent slot addresses or filesystem paths. Connector owns Workflow, Session, Project, Chat and iteration state.");
        sb.AppendLine("String/free-form/multiline slots must use payload_id. Number, boolean and enum slots use direct JSON values.");
        sb.AppendLine("Every referenced payload must have exactly one block; do not add unreferenced blocks. Preserve the exact boundary_id.");
        sb.AppendLine();
        if (handoff.AllowedActions.Contains("generate", StringComparer.Ordinal))
        {
            sb.AppendLine("Generate response grammar:");
            sb.AppendLine("```connector-command");
            sb.AppendLine($"{{\"protocol\":\"{ConnectorProtocol.Version}\",\"action\":\"generate\",\"handoff_id\":\"<echo supplied handoff_id>\",\"session_id\":\"<echo supplied session_id>\",\"slots\":{{\"<payload-string-slot-address>\":{{\"payload_id\":\"prompt-main\"}},\"<numeric-slot-address>\":5}}}}");
            sb.AppendLine("```");
            sb.AppendLine("<<<COMFY_PAYLOAD:prompt-main:<supplied-boundary>>>");
            sb.AppendLine("<raw UTF-8 text>");
            sb.AppendLine("<<<END_COMFY_PAYLOAD:prompt-main:<supplied-boundary>>>");
        }
        if (handoff.AllowedActions.Contains("complete", StringComparer.Ordinal))
        {
            sb.AppendLine("Complete response grammar:");
            sb.AppendLine("```connector-command");
            sb.AppendLine($"{{\"protocol\":\"{ConnectorProtocol.Version}\",\"action\":\"complete\",\"handoff_id\":\"<echo supplied handoff_id>\",\"session_id\":\"<echo supplied session_id>\",\"reason\":\"<concise reason>\"}}");
            sb.AppendLine("```");
        }
        sb.AppendLine();
        sb.AppendLine("## Current creation context");
        sb.AppendLine($"Project: {session.ProjectLabel}");
        sb.AppendLine($"Chat: {session.ChatLabel}");
        sb.AppendLine($"Workflow: {session.BoundWorkflow?.RelativePath ?? "(not selected)"}");
        sb.AppendLine($"Maximum iterations: {session.MaximumIterations}");
        sb.AppendLine($"Current iteration: {session.CurrentIteration}");
        sb.AppendLine("Kickoff instruction (optional):");
        var kickoffInstruction = handoff.KickoffInstruction ?? session.OriginalIdea;
        sb.AppendLine(string.IsNullOrWhiteSpace(kickoffInstruction)
            ? "(none — use the existing ChatGPT conversation)"
            : kickoffInstruction);
        if (iteration is not null)
        {
            sb.AppendLine();
            sb.AppendLine("## Output under review");
            sb.AppendLine($"Iteration: {iteration.Number}");
            sb.AppendLine($"Status: {iteration.Status}");
            sb.AppendLine($"Prompt: {iteration.Prompt}");
            sb.AppendLine("Output media (local metadata; do not claim you read these files unless the user attaches them):");
            foreach (var output in iteration.Outputs) sb.AppendLine($"- {BuildChatGptOutputMetadata(output)}");
            sb.AppendLine("Evaluate user-attached media.");
            sb.AppendLine("Do not claim to have inspected local-only media unless it is actually attached to the ChatGPT conversation.");
            sb.AppendLine("Use generate for a changed next iteration, or complete only if allowed and the goal is met.");
        }
        sb.AppendLine();
        sb.AppendLine("## Available writable slot schema");
        // A Handoff must never publish the same protocol address twice. The
        // factory already canonicalizes discovery results; this final guard
        // protects rendering when an older/corrupt persisted PendingHandoff is
        // encountered and fails explicitly instead of producing ambiguous
        // instructions for ChatGPT.
        var writableSlots = SlotSchemaPolicy.RequireUniqueSnapshots(handoff.Slots)
            .Where(slot => slot.IsWritableByChatGpt)
            .ToArray();
        if (writableSlots.Length == 0) sb.AppendLine("(No writable creative slots are available. A generate response must use an empty slots object.)");
        foreach (var slot in writableSlots)
        {
            var choices = slot.Choices is null ? string.Empty : $" | choices={ToHandoffJson(slot.Choices)}";
            var range = slot.Minimum is null && slot.Maximum is null ? string.Empty : $" | range={slot.Minimum?.ToString(CultureInfo.InvariantCulture) ?? "-∞"}..{slot.Maximum?.ToString(CultureInfo.InvariantCulture) ?? "+∞"}";
            sb.AppendLine($"- {slot.Address} | label={slot.Label} | type={slot.Type} | current={ToHandoffJson(slot.CurrentValue)} | transport={slot.Transport.ToString().ToLowerInvariant()} | writable=true{choices}{range}");
        }
        return sb.ToString();
    }

    /// <summary>
    /// Builds the deliberately reduced output representation used in a
    /// ChatGPT-facing Review Handoff.  OutputArtifact.FullPath remains an
    /// internal-only value for the Viewer, History and OPEN actions; it must
    /// never cross the Handoff boundary.
    /// </summary>
    private static string BuildChatGptOutputMetadata(OutputArtifact output)
    {
        var fileName = GetSafeOutputFileName(output);
        var mediaType = ResolveMediaType(output, fileName);
        var available = (!output.IsMissing).ToString().ToLowerInvariant();
        return $"{fileName} | type={mediaType} | local_only=true | available={available}";
    }

    private static string GetSafeOutputFileName(OutputArtifact output)
    {
        // OutputArtifact instances normally receive a basename from
        // WorkflowCatalog.  Normalize both separators here as a defense for
        // older or hand-authored persisted sessions whose FileName may still
        // contain a full Windows path.
        var candidate = string.IsNullOrWhiteSpace(output.FileName) ? output.FullPath : output.FileName;
        candidate = candidate.Replace('\\', '/');
        var separator = candidate.LastIndexOf('/');
        var fileName = separator >= 0 ? candidate[(separator + 1)..] : candidate;
        return string.IsNullOrWhiteSpace(fileName) ? "(unnamed output)" : fileName;
    }

    private static string ResolveMediaType(OutputArtifact output, string fileName)
    {
        var declaredType = output.Type?.Trim() ?? string.Empty;
        if (declaredType.Contains('/', StringComparison.Ordinal)
            && declaredType.All(character => char.IsLetterOrDigit(character) || character is '/' or '.' or '+' or '-'))
        {
            return declaredType.ToLowerInvariant();
        }

        var extension = Path.GetExtension(fileName).TrimStart('.').ToLowerInvariant();
        if (string.IsNullOrWhiteSpace(extension)) extension = declaredType.TrimStart('.').ToLowerInvariant();
        return extension switch
        {
            "mp4" => "video/mp4",
            "webm" => "video/webm",
            "mov" => "video/quicktime",
            "avi" => "video/x-msvideo",
            "mkv" => "video/x-matroska",
            "png" => "image/png",
            "jpg" or "jpeg" => "image/jpeg",
            "webp" => "image/webp",
            "gif" => "image/gif",
            "bmp" => "image/bmp",
            _ => "application/octet-stream",
        };
    }

    private static string ToHandoffJson(JsonNode? node)
    {
        if (node is null) return "null";
        if (node is JsonValue value && value.TryGetValue<string>(out var text)) return QuoteHumanReadableJsonString(text);
        if (node is JsonArray array) return $"[{string.Join(",", array.Select(ToHandoffJson))}]";
        return node.ToJsonString();
    }

    private static string QuoteHumanReadableJsonString(string value)
    {
        var sb = new StringBuilder(value.Length + 2).Append('"');
        foreach (var character in value)
        {
            _ = character switch
            {
                '"' => sb.Append("\\\""),
                '\\' => sb.Append("\\\\"),
                '\b' => sb.Append("\\b"),
                '\f' => sb.Append("\\f"),
                '\n' => sb.Append("\\n"),
                '\r' => sb.Append("\\r"),
                '\t' => sb.Append("\\t"),
                < ' ' => sb.Append($"\\u{(int)character:x4}"),
                _ => sb.Append(character),
            };
        }
        return sb.Append('"').ToString();
    }
}
