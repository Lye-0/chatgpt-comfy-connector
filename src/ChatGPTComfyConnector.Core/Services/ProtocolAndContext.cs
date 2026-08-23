using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using ChatGPTComfyConnector.Core.Models;

namespace ChatGPTComfyConnector.Core.Services;

public static class ConnectorProtocol
{
    public const string Version = "comfy-connector/1";

    public static ProtocolValidationResult Parse(string raw)
    {
        var result = new ProtocolValidationResult();
        if (string.IsNullOrWhiteSpace(raw))
        {
            result.Errors.Add("Commandが空です。");
            return result;
        }

        var jsonText = ExtractJson(raw, result.Errors);
        if (jsonText is null) return result;

        JsonNode? node;
        try
        {
            node = JsonNode.Parse(jsonText);
        }
        catch (JsonException ex)
        {
            result.Errors.Add($"JSONを解析できません: {ex.Message}");
            return result;
        }

        if (node is not JsonObject obj)
        {
            result.Errors.Add("CommandのルートはJSON objectである必要があります。");
            return result;
        }

        var protocol = ReadString(obj, "protocol", result.Errors);
        var action = ReadString(obj, "action", result.Errors);
        if (!string.Equals(protocol, Version, StringComparison.Ordinal)) result.Errors.Add($"protocolは {Version} である必要があります。");
        if (action is not ("generate" or "complete")) result.Errors.Add("actionは generate または complete だけを指定できます。");

        var parameters = obj["parameters"] as JsonObject ?? [];
        var reason = ReadString(obj, "reason", result.Errors);
        var workflow = ReadString(obj, "workflow", result.Errors);
        if (workflow is not null && (Path.IsPathRooted(workflow) || workflow.Contains("..", StringComparison.Ordinal)))
        {
            result.Errors.Add("workflowに絶対パスや親ディレクトリ参照は指定できません。");
        }

        if (action == "generate" && obj["parameters"] is not JsonObject)
        {
            result.Errors.Add("generateにはparameters objectが必要です。");
        }

        if (reason is not null && reason.Length > 1000) result.Errors.Add("reasonは1000文字以内です。");
        if (result.Errors.Count == 0)
        {
            result.Command = new ConnectorCommand
            {
                Protocol = protocol!,
                Action = action!,
                Parameters = parameters,
                Reason = reason,
                Workflow = workflow,
            };
        }

        return result;
    }

    public static ProtocolValidationResult ValidateAgainstSlots(ConnectorCommand command, IEnumerable<WorkflowSlot> slots, WorkflowIdentity? boundWorkflow)
    {
        var result = new ProtocolValidationResult { Command = command };
        if (!string.Equals(command.Protocol, Version, StringComparison.Ordinal)) result.Errors.Add("Protocol versionが一致しません。");
        if (command.Action is not ("generate" or "complete")) result.Errors.Add("許可されていないactionです。");
        if (command.Workflow is not null && boundWorkflow is not null && !string.Equals(command.Workflow.Replace('\\', '/'), boundWorkflow.RelativePath, StringComparison.OrdinalIgnoreCase))
        {
            result.Errors.Add("CommandのWorkflowが現在のSessionにbindされたWorkflowと一致しません。");
        }

        if (command.Action == "generate")
        {
            var allowed = slots.Select(s => s.Address).ToHashSet(StringComparer.OrdinalIgnoreCase);
            foreach (var property in command.Parameters)
            {
                if (!allowed.Contains(property.Key)) result.Errors.Add($"存在しないslotです: {property.Key}");
                if (property.Value is null) result.Errors.Add($"slot値をnullにはできません: {property.Key}");
            }
        }

        return result;
    }

    private static string? ExtractJson(string raw, ICollection<string> errors)
    {
        var text = raw.Trim();
        if (!text.StartsWith("```", StringComparison.Ordinal)) return text;
        var lines = text.Split(["\r\n", "\n"], StringSplitOptions.None);
        var fences = lines.Count(line => line.TrimStart().StartsWith("```", StringComparison.Ordinal));
        if (fences != 2)
        {
            errors.Add("Markdown code fenceが1つのJSON commandを囲んでいる必要があります。");
            return null;
        }

        var start = 1;
        var language = lines[0].Trim().Trim('`').Trim();
        if (language.Length > 0 && language is not ("json" or "connector-command")) errors.Add($"未対応のcode fence言語です: {language}");
        var end = Array.FindIndex(lines, 1, line => line.TrimStart().StartsWith("```", StringComparison.Ordinal));
        if (end < 0) { errors.Add("code fenceの終端がありません。"); return null; }
        return string.Join(Environment.NewLine, lines[start..end]).Trim();
    }

    private static string? ReadString(JsonObject obj, string propertyName, ICollection<string> errors)
    {
        var value = obj[propertyName];
        if (value is null) return null;
        if (value is JsonValue jsonValue && jsonValue.TryGetValue<string>(out var text)) return text;
        errors.Add($"{propertyName}は文字列である必要があります。");
        return null;
    }
}

public static class ConnectorContextBuilder
{
    public static string BuildBootstrap(CreationSession session, IEnumerable<WorkflowSlot> slots)
    {
        var sb = new StringBuilder();
        sb.AppendLine("You are the creative director and iteration partner for ChatGPT Comfy Connector.");
        sb.AppendLine($"Connector Protocol: {ConnectorProtocol.Version}");
        sb.AppendLine("Return exactly one JSON command in a connector-command code fence.");
        sb.AppendLine("Allowed actions: generate, complete. Do not invent slots or filesystem paths.");
        sb.AppendLine($"Session: {session.Id} / {session.Title}");
        sb.AppendLine($"Workflow: {session.BoundWorkflow?.RelativePath ?? "(not selected)"}");
        sb.AppendLine($"Maximum iterations: {session.MaximumIterations}; current: {session.CurrentIteration}");
        sb.AppendLine($"Original idea: {session.OriginalIdea}");
        sb.AppendLine("Available slots:");
        foreach (var slot in slots)
        {
            var choices = slot.Choices is null ? string.Empty : $" choices={slot.Choices.ToJsonString()}";
            sb.AppendLine($"- {slot.Address} | {slot.Label} | type={slot.Type} | current={slot.CurrentText}{choices}");
        }
        sb.AppendLine("For generate, include only slot addresses listed above. For complete, include a concise reason.");
        return sb.ToString();
    }

    public static string BuildResult(CreationSession session, SessionIteration iteration)
    {
        var sb = new StringBuilder();
        sb.AppendLine("Connector generation result. Attach the output media manually in ChatGPT.");
        sb.AppendLine($"Session: {session.Title} ({session.Id})");
        sb.AppendLine($"Iteration: {iteration.Number}");
        sb.AppendLine($"Workflow: {session.BoundWorkflow?.RelativePath ?? "(not selected)"}");
        sb.AppendLine($"Status: {iteration.Status}");
        sb.AppendLine($"Prompt: {iteration.Prompt}");
        sb.AppendLine("Parameters:");
        foreach (var parameter in iteration.Parameters) sb.AppendLine($"- {parameter.Key}: {parameter.Value?.ToJsonString() ?? "null"}");
        sb.AppendLine("Outputs:");
        foreach (var output in iteration.Outputs) sb.AppendLine($"- {output.FileName} ({output.Type}) | {output.FullPath} | {(output.IsMissing ? "Missing" : "Available")}");
        sb.AppendLine("Evaluate the attached media. Return generate for an improvement or complete when the goal is met.");
        sb.AppendLine("Local absolute paths above are metadata only; do not claim to have read them from ChatGPT.");
        return sb.ToString();
    }
}
