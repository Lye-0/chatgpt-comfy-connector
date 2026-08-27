using System.Text.Json.Nodes;
using ChatGPTComfyConnector.Core.Models;
using ChatGPTComfyConnector.Core.Services;

namespace ChatGPTComfyConnector.Tests;

public sealed class ProtocolTests
{
    [Fact]
    public void ResolvesRawPayloadWithoutNormalizingItsContent()
    {
        var pending = Pending();
        var payload = "  夜の東京: it's \"quoted\"; {\"json\":true}\\path\n\n```markdown\n日本語 🚗\n```  ";
        var response = Generate(pending, "{\"6.text\":{\"payload_id\":\"prompt-main\"}}")
            + $"\n<<<COMFY_PAYLOAD:prompt-main:{pending.BoundaryId}>>>\n{payload}\n<<<END_COMFY_PAYLOAD:prompt-main:{pending.BoundaryId}>>>";

        var result = ConnectorProtocol.Parse(response, pending);

        Assert.True(result.IsValid, string.Join(" | ", result.Errors));
        Assert.Equal(payload, result.Command!.ResolvedSlots["6.text"]!.GetValue<string>());
        Assert.Equal(response, result.RawResponse);
    }

    [Fact]
    public void SupportsLargeAndMultiplePayloadsPlusDirectJsonValues()
    {
        var pending = Pending();
        var first = string.Concat(Enumerable.Repeat("長いPrompt\n", 2000));
        var second = "negative: blur; artifacts";
        var response = Generate(pending, "{\"6.text\":{\"payload_id\":\"main\"},\"7.text\":{\"payload_id\":\"negative\"},\"10.steps\":24,\"11.enabled\":false}")
            + $"\n<<<COMFY_PAYLOAD:main:{pending.BoundaryId}>>>\n{first}\n<<<END_COMFY_PAYLOAD:main:{pending.BoundaryId}>>>"
            + $"\n<<<COMFY_PAYLOAD:negative:{pending.BoundaryId}>>>\n{second}\n<<<END_COMFY_PAYLOAD:negative:{pending.BoundaryId}>>>";

        var result = ConnectorProtocol.Parse(response, pending);

        Assert.True(result.IsValid, string.Join(" | ", result.Errors));
        Assert.Equal(first, result.Command!.Parameters["6.text"]!.GetValue<string>());
        Assert.Equal(24, result.Command.Parameters["10.steps"]!.GetValue<int>());
        Assert.False(result.Command.Parameters["11.enabled"]!.GetValue<bool>());
    }

    [Fact]
    public void AcceptsJsonOnlyGenerateAndReviewComplete()
    {
        var pending = Pending("generate", "complete");
        var generate = ConnectorProtocol.Parse(Generate(pending, "{\"10.steps\":25}"), pending);
        var complete = ConnectorProtocol.Parse($"```connector-command\n{{\"protocol\":\"comfy-connector/1\",\"action\":\"complete\",\"handoff_id\":\"{pending.HandoffId}\",\"session_id\":\"{pending.SessionId}\",\"reason\":\"目的を満たした\"}}\n```", pending);

        Assert.True(generate.IsValid, string.Join(" | ", generate.Errors));
        Assert.True(complete.IsValid, string.Join(" | ", complete.Errors));
    }

    [Fact]
    public void AcceptsJsonFenceAndFenceLessRawJson()
    {
        var pending = Pending();
        var json = RawGenerate(pending, "{\"10.steps\":25}");

        var jsonFence = ConnectorProtocol.Parse($"```json\n{json}\n```", pending);
        var unlabeledFence = ConnectorProtocol.Parse($"```\n{json}\n```", pending);
        var raw = ConnectorProtocol.Parse(json, pending);

        Assert.True(jsonFence.IsValid, string.Join(" | ", jsonFence.Errors));
        Assert.True(unlabeledFence.IsValid, string.Join(" | ", unlabeledFence.Errors));
        Assert.True(raw.IsValid, string.Join(" | ", raw.Errors));
        Assert.Equal(25, raw.Command!.Parameters["10.steps"]!.GetValue<int>());
    }

    [Fact]
    public void AcceptsExplanatoryTextAroundOneRawJsonObject()
    {
        var pending = Pending("generate", "complete");
        var json = $"{{\"protocol\":\"{ConnectorProtocol.Version}\",\"action\":\"complete\",\"handoff_id\":\"{pending.HandoffId}\",\"session_id\":\"{pending.SessionId}\",\"reason\":\"approved {{after review}}\"}}";

        var result = ConnectorProtocol.Parse($"Here is the Connector Response:\n{json}\nPaste this into the Connector.", pending);

        Assert.True(result.IsValid, string.Join(" | ", result.Errors));
        Assert.Equal("complete", result.Command!.Action);
        Assert.Equal("approved {after review}", result.Command.Reason);
    }

    [Fact]
    public void RawJsonScannerHandlesNestedObjectsAndBracesInsideStrings()
    {
        var pending = Pending();
        var json = RawGenerate(pending, "{\"6.text\":{\"payload_id\":\"main\"},\"10.steps\":25}");
        var payload = "prompt with {braces} and escaped \\\"quotes\\\"";
        var response = $"Assistant note\n{json}\n<<<COMFY_PAYLOAD:main:{pending.BoundaryId}>>>\n{payload}\n<<<END_COMFY_PAYLOAD:main:{pending.BoundaryId}>>>";

        var result = ConnectorProtocol.Parse(response, pending);

        Assert.True(result.IsValid, string.Join(" | ", result.Errors));
        Assert.Equal(payload, result.Command!.Parameters["6.text"]!.GetValue<string>());

        var fenced = $"```json\n{json}\n```\n<<<COMFY_PAYLOAD:main:{pending.BoundaryId}>>>\n{payload}\n<<<END_COMFY_PAYLOAD:main:{pending.BoundaryId}>>>";
        var fencedResult = ConnectorProtocol.Parse(fenced, pending);
        Assert.True(fencedResult.IsValid, string.Join(" | ", fencedResult.Errors));
    }

    [Fact]
    public void RejectsMultipleRawJsonObjectsAndUnsupportedFences()
    {
        var pending = Pending();
        var json = RawGenerate(pending, "{\"10.steps\":25}");

        var multiple = ConnectorProtocol.Parse($"first {json}\nsecond {json}", pending);
        var unsupported = ConnectorProtocol.Parse($"```javascript\n{json}\n```", pending);

        Assert.False(multiple.IsValid);
        Assert.Contains(multiple.Errors, error => error.Contains("JSON objectを1つ", StringComparison.Ordinal));
        Assert.False(unsupported.IsValid);
        Assert.Contains(unsupported.Errors, error => error.Contains("未対応", StringComparison.Ordinal));
    }

    [Fact]
    public void RejectsRawNonObjectAndProtocolMismatch()
    {
        var pending = Pending();
        var nonObject = ConnectorProtocol.Parse("[1, 2, 3]", pending);
        var wrongProtocol = ConnectorProtocol.Parse(RawGenerate(pending, "{\"10.steps\":25}").Replace(ConnectorProtocol.Version, "comfy-connector/2", StringComparison.Ordinal), pending);

        Assert.False(nonObject.IsValid);
        Assert.False(wrongProtocol.IsValid);
        Assert.Contains(wrongProtocol.Errors, error => error.Contains("protocol", StringComparison.Ordinal));
    }

    [Theory]
    [InlineData("wrong-handoff", false)]
    [InlineData("wrong-session", true)]
    public void RejectsStaleOrWrongIdentity(string replacement, bool replaceSession)
    {
        var pending = Pending();
        var response = Generate(pending, "{}")
            .Replace(replaceSession ? pending.SessionId : pending.HandoffId, replacement, StringComparison.Ordinal);
        var result = ConnectorProtocol.Parse(response, pending);
        Assert.False(result.IsValid);
        Assert.Contains(result.Errors, error => error.Contains(replaceSession ? "session_id" : "以前のHandoff", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public void RejectsCompleteWhenNotAllowed()
    {
        var pending = Pending("generate");
        var response = $"```connector-command\n{{\"protocol\":\"comfy-connector/1\",\"action\":\"complete\",\"handoff_id\":\"{pending.HandoffId}\",\"session_id\":\"{pending.SessionId}\",\"reason\":\"done\"}}\n```";
        var result = ConnectorProtocol.Parse(response, pending);
        Assert.False(result.IsValid);
        Assert.Contains(result.Errors, error => error.Contains("許可", StringComparison.Ordinal));
    }

    [Theory]
    [InlineData("wrong-boundary")]
    [InlineData("missing-payload")]
    [InlineData("unreferenced")]
    [InlineData("duplicate-command")]
    public void RejectsInvalidEnvelopeForms(string scenario)
    {
        var pending = Pending();
        var response = Generate(pending, scenario == "missing-payload" ? "{\"6.text\":{\"payload_id\":\"main\"}}" : "{}");
        response += scenario switch
        {
            "wrong-boundary" => "\n<<<COMFY_PAYLOAD:extra:wrong>>>\nx\n<<<END_COMFY_PAYLOAD:extra:wrong>>>",
            "unreferenced" => $"\n<<<COMFY_PAYLOAD:extra:{pending.BoundaryId}>>>\nx\n<<<END_COMFY_PAYLOAD:extra:{pending.BoundaryId}>>>",
            "duplicate-command" => "\n" + Generate(pending, "{}"),
            _ => string.Empty,
        };
        Assert.False(ConnectorProtocol.Parse(response, pending).IsValid);
    }

    [Fact]
    public void DifferentBoundaryEndMarkerInsidePromptRemainsRawText()
    {
        var pending = Pending();
        var payload = "before\n<<<END_COMFY_PAYLOAD:main:another-boundary>>>\nafter";
        var response = Generate(pending, "{\"6.text\":{\"payload_id\":\"main\"}}")
            + $"\n<<<COMFY_PAYLOAD:main:{pending.BoundaryId}>>>\n{payload}\n<<<END_COMFY_PAYLOAD:main:{pending.BoundaryId}>>>";
        var result = ConnectorProtocol.Parse(response, pending);
        Assert.True(result.IsValid, string.Join(" | ", result.Errors));
        Assert.Equal(payload, result.Command!.Parameters["6.text"]!.GetValue<string>());
    }

    [Fact]
    public void RejectsMissingEndAndDuplicatePayloadId()
    {
        var pending = Pending();
        var command = Generate(pending, "{\"6.text\":{\"payload_id\":\"main\"}}");
        var missingEnd = command + $"\n<<<COMFY_PAYLOAD:main:{pending.BoundaryId}>>>\ntext";
        var block = $"<<<COMFY_PAYLOAD:main:{pending.BoundaryId}>>>\ntext\n<<<END_COMFY_PAYLOAD:main:{pending.BoundaryId}>>>";
        Assert.False(ConnectorProtocol.Parse(missingEnd, pending).IsValid);
        Assert.False(ConnectorProtocol.Parse(command + "\n" + block + "\n" + block, pending).IsValid);
    }

    [Fact]
    public void RejectsInvalidPayloadIdOrOrphanEndMarker()
    {
        var pending = Pending();
        var invalidId = Generate(pending, "{\"6.text\":{\"payload_id\":\"bad id\"}}")
            + $"\n<<<COMFY_PAYLOAD:bad id:{pending.BoundaryId}>>>\nx\n<<<END_COMFY_PAYLOAD:bad id:{pending.BoundaryId}>>>";
        var orphan = Generate(pending, "{}") + $"\n<<<END_COMFY_PAYLOAD:main:{pending.BoundaryId}>>>";
        Assert.False(ConnectorProtocol.Parse(invalidId, pending).IsValid);
        Assert.False(ConnectorProtocol.Parse(orphan, pending).IsValid);
    }

    [Fact]
    public void RejectsWrongProtocol()
    {
        var pending = Pending();
        var response = Generate(pending, "{}").Replace("comfy-connector/1", "comfy-connector/2", StringComparison.Ordinal);
        Assert.False(ConnectorProtocol.Parse(response, pending).IsValid);
    }

    [Fact]
    public void RejectsUnknownSlotWrongTypeChoiceRangeAndUnchangedValue()
    {
        var pending = Pending();
        var cases = new[]
        {
            Generate(pending, "{\"999.secret\":1}"),
            Generate(pending, "{\"10.steps\":true}"),
            Generate(pending, "{\"12.mode\":\"invalid\"}"),
            Generate(pending, "{\"10.steps\":101}"),
            Generate(pending, "{\"10.steps\":20}"),
            Generate(pending, "{\"6.text\":\"must-use-payload\"}"),
        };
        Assert.All(cases, response => Assert.False(ConnectorProtocol.Parse(response, pending).IsValid));
    }

    [Fact]
    public void ContextUsesExistingConversationAndOptionalKickoffInstruction()
    {
        var session = new CreationSession
        {
            Id = "session-1", ProjectLabel = "Project", ChatLabel = "Chat", OriginalIdea = "夜の東京",
            BoundWorkflow = WorkflowIdentity.Create("folder/workflow.json"), MaximumIterations = 10,
        };
        var pending = PendingHandoffFactory.Create(session, [new WorkflowSlot { Address = "6.text", Label = "Prompt", Type = "STRING", CurrentValue = JsonValue.Create("old") }], "generate");
        var text = ConnectorContextBuilder.BuildBootstrap(session, pending);
        Assert.Contains(pending.HandoffId, text);
        Assert.Contains(pending.BoundaryId, text);
        Assert.Contains("Available writable slot schema", text);
        Assert.Contains("transport=payload", text);
        Assert.Contains("use that conversation history as the production context", text);
        Assert.Contains("Use that production context to create detailed generation instructions for the selected Workflow.", text);
        Assert.Contains("If a Kickoff instruction is provided below, treat it as an additional instruction", text);
        Assert.Contains("Kickoff instruction (optional):", text);
        Assert.Contains("夜の東京", text);
        Assert.DoesNotContain("Original idea:", text);
        Assert.DoesNotContain("self-contained; do not rely on earlier chat context", text);
        Assert.DoesNotContain("Complete response grammar", text);
        Assert.DoesNotContain("\\# ChatGPT", text);
        Assert.Contains("```connector-command", text);
    }

    [Theory]
    [InlineData("prompt", "STRING", true)]
    [InlineData("seed", "INT", true)]
    [InlineData("duration", "FLOAT", true)]
    [InlineData("filename_prefix", "STRING", false)]
    [InlineData("unet_name", "COMBO", false)]
    [InlineData("vae_name", "COMBO", false)]
    [InlineData("clip_name", "COMBO", false)]
    [InlineData("expression", "STRING", false)]
    [InlineData("mystery_setting", "STRING", false)]
    public void SlotPolicyUsesSafeCreativeAllowList(string label, string type, bool expectedWritable)
    {
        var snapshot = ChatGptSlotPolicy.CreateSnapshot(new WorkflowSlot
        {
            Address = $"1.{label}", Label = label, Type = type, CurrentValue = JsonValue.Create("value"),
            Choices = type == "COMBO" ? ["value", "other"] : null,
        });

        Assert.Equal(expectedWritable, snapshot.IsWritableByChatGpt);
    }

    [Fact]
    public void ComboRequiresKnownChoicesAndDynamicComboIsRecognized()
    {
        var unknownChoices = ChatGptSlotPolicy.CreateSnapshot(new WorkflowSlot
        {
            Address = "1.aspect_ratio", Label = "aspect_ratio", Type = "COMFY_DYNAMICCOMBO_V3", CurrentValue = JsonValue.Create("16:9"), Choices = [],
        });
        var knownChoices = ChatGptSlotPolicy.CreateSnapshot(new WorkflowSlot
        {
            Address = "2.aspect_ratio", Label = "aspect_ratio", Type = "COMBO", CurrentValue = JsonValue.Create("16:9"), Choices = ["16:9", "9:16"],
        });

        Assert.Equal(WorkflowSlotType.Enum, unknownChoices.Kind);
        Assert.Equal(ChatGptSlotExposure.ReadOnly, unknownChoices.Exposure);
        Assert.True(knownChoices.IsWritableByChatGpt);
    }

    [Fact]
    public void ValidatorRejectsReadOnlyAndChoiceOutsideSnapshot()
    {
        var pending = Pending();
        pending.Slots.Add(new HandoffSlotSnapshot
        {
            Address = "20.filename_prefix", Label = "filename_prefix", Type = "STRING", CurrentValue = JsonValue.Create("video/current"),
            Transport = SlotValueTransport.Payload, Exposure = ChatGptSlotExposure.Hidden,
        });
        var hiddenResponse = Generate(pending, "{\"20.filename_prefix\":{\"payload_id\":\"path\"}}")
            + $"\n<<<COMFY_PAYLOAD:path:{pending.BoundaryId}>>>\nvideo/changed\n<<<END_COMFY_PAYLOAD:path:{pending.BoundaryId}>>>";
        var invalidChoice = Generate(pending, "{\"12.mode\":\"cinematic\"}");

        Assert.False(ConnectorProtocol.Parse(hiddenResponse, pending).IsValid);
        Assert.False(ConnectorProtocol.Parse(invalidChoice, pending).IsValid);
    }

    [Fact]
    public void ValidationUsesIssuedSnapshotAfterDiscoveredSlotChanges()
    {
        var session = new CreationSession { Id = "session-1", BoundWorkflow = WorkflowIdentity.Create("folder/test.json") };
        var discovered = new WorkflowSlot
        {
            Address = "12.aspect_ratio", Label = "aspect_ratio", Type = "COMBO", CurrentValue = JsonValue.Create("16:9"), Choices = ["16:9", "9:16"],
        };
        var pending = PendingHandoffFactory.Create(session, [discovered], "generate");
        discovered.Choices = ["1:1"];

        var issuedChoice = ConnectorProtocol.Parse(Generate(pending, "{\"12.aspect_ratio\":\"9:16\"}"), pending);
        var laterChoice = ConnectorProtocol.Parse(Generate(pending, "{\"12.aspect_ratio\":\"1:1\"}"), pending);

        Assert.True(issuedChoice.IsValid, string.Join(" | ", issuedChoice.Errors));
        Assert.False(laterChoice.IsValid);
    }

    [Fact]
    public void HandoffKeepsReadableUnicodeSymbolsAndExactMarkers()
    {
        var session = new CreationSession
        {
            Id = "session-1", ProjectLabel = "映像 + Project 🚗", ChatLabel = "新しい制作", OriginalIdea = "夜の東京 + 雨 🚗",
            BoundWorkflow = WorkflowIdentity.Create("folder/workflow.json"),
        };
        var pending = PendingHandoffFactory.Create(session,
        [
            new WorkflowSlot { Address = "6.prompt", Label = "prompt", Type = "STRING", CurrentValue = JsonValue.Create("夜の東京 + 雨 🚗") },
        ], "generate");

        var text = ConnectorContextBuilder.BuildBootstrap(session, pending);

        Assert.Contains("current=\"夜の東京 + 雨 🚗\"", text);
        Assert.DoesNotContain("\\u", text, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("<<<COMFY_PAYLOAD:prompt-main:<supplied-boundary>>>", text);
        Assert.DoesNotContain("\\<<<COMFY_PAYLOAD", text);
    }

    [Fact]
    public void WorkflowIdentityCannotEscapeRoot()
    {
        Assert.Throws<ArgumentException>(() => WorkflowIdentity.Create("../outside.json"));
        Assert.Throws<ArgumentException>(() => WorkflowIdentity.Create("C:/outside.json"));
    }

    [Fact]
    public void ClassifiesImageAndVideoOutputs()
    {
        Assert.True(new OutputArtifact { FullPath = "C:\\output\\frame.png", Type = "png" }.IsImage);
        Assert.True(new OutputArtifact { FullPath = "C:\\output\\clip.mp4", Type = "mp4" }.IsVideo);
    }

    [Fact]
    public void ReviewHandoffPublishesSafeOutputMetadataWithoutLocalPath()
    {
        var localPath = Path.Combine("C:\\AI", "ComfyUI_windows_portable", "ComfyUI", "output", "e5730de5_000.mp4");
        var session = new CreationSession
        {
            Id = "session-review-output", ProjectLabel = "Project", ChatLabel = "Chat",
            OriginalIdea = string.Empty, BoundWorkflow = WorkflowIdentity.Create("folder/workflow.json"),
            MaximumIterations = 10, CurrentIteration = 1,
        };
        var pending = PendingHandoffFactory.Create(session, [], "generate", "complete");
        var iteration = new SessionIteration
        {
            Number = 1,
            Status = JobStatus.Completed,
            Prompt = "A polished night drive",
            Outputs = [new OutputArtifact { FileName = "e5730de5_000.mp4", FullPath = localPath, Type = "mp4" }],
        };

        var text = ConnectorContextBuilder.BuildResult(session, iteration, pending);

        Assert.Equal(localPath, iteration.Outputs[0].FullPath);
        Assert.Contains("e5730de5_000.mp4 | type=video/mp4 | local_only=true | available=", text);
        Assert.DoesNotContain(localPath, text, StringComparison.Ordinal);
        Assert.DoesNotContain("C:\\AI", text, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void ReviewHandoffStripsPathFromPersistedFileNameAndKeepsMimeType()
    {
        var session = new CreationSession
        {
            Id = "session-review-output-name", ProjectLabel = "Project", ChatLabel = "Chat",
            BoundWorkflow = WorkflowIdentity.Create("folder/workflow.json"), MaximumIterations = 10,
        };
        var pending = PendingHandoffFactory.Create(session, [], "generate", "complete");
        var iteration = new SessionIteration
        {
            Number = 1,
            Status = JobStatus.Completed,
            Outputs = [new OutputArtifact { FileName = "C:\\private\\frame.png", FullPath = "C:\\private\\frame.png", Type = "png" }],
        };

        var text = ConnectorContextBuilder.BuildResult(session, iteration, pending);

        Assert.Contains("- frame.png | type=image/png | local_only=true | available=false", text);
        Assert.DoesNotContain("C:\\private", text, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void BlankKickoffInstructionUsesExistingConversationContext()
    {
        var session = new CreationSession
        {
            Id = "session-blank-kickoff", ProjectLabel = "Project", ChatLabel = "Chat",
            OriginalIdea = string.Empty, BoundWorkflow = WorkflowIdentity.Create("folder/workflow.json"),
            MaximumIterations = 10,
        };
        var pending = PendingHandoffFactory.Create(session, [], "generate");

        var text = ConnectorContextBuilder.BuildBootstrap(session, pending);

        Assert.Contains("If the Kickoff instruction is blank, begin from the existing conversation context.", text);
        Assert.Contains("(none — use the existing ChatGPT conversation)", text);
        Assert.DoesNotContain("Original idea:", text);
    }

    private static PendingHandoffSnapshot Pending(params string[] actions)
        => new()
        {
            HandoffId = "handoff-1", SessionId = "session-1", BoundaryId = "boundary123", WorkflowIdentity = "folder/test.json",
            AllowedActions = (actions.Length == 0 ? ["generate"] : actions).ToList(),
            Slots =
            [
                new() { Address = "6.text", Label = "Prompt", Type = "STRING", CurrentValue = JsonValue.Create("old"), Transport = SlotValueTransport.Payload, Exposure = ChatGptSlotExposure.Writable },
                new() { Address = "7.text", Label = "Negative", Type = "STRING", CurrentValue = JsonValue.Create("old negative"), Transport = SlotValueTransport.Payload, Exposure = ChatGptSlotExposure.Writable },
                new() { Address = "10.steps", Label = "Steps", Type = "INT", CurrentValue = JsonValue.Create(20), Minimum = 1, Maximum = 100, Transport = SlotValueTransport.Json, Exposure = ChatGptSlotExposure.Writable },
                new() { Address = "11.enabled", Label = "Enabled", Type = "BOOLEAN", CurrentValue = JsonValue.Create(true), Transport = SlotValueTransport.Json, Exposure = ChatGptSlotExposure.Writable },
                new() { Address = "12.mode", Label = "Mode", Type = "COMBO", CurrentValue = JsonValue.Create("fast"), Choices = ["fast", "quality"], Transport = SlotValueTransport.Json, Exposure = ChatGptSlotExposure.Writable },
            ],
        };

    private static string Generate(PendingHandoffSnapshot pending, string slots)
        => $"```connector-command\n{{\"protocol\":\"comfy-connector/1\",\"action\":\"generate\",\"handoff_id\":\"{pending.HandoffId}\",\"session_id\":\"{pending.SessionId}\",\"slots\":{slots}}}\n```";

    private static string RawGenerate(PendingHandoffSnapshot pending, string slots)
        => $"{{\"protocol\":\"{ConnectorProtocol.Version}\",\"action\":\"generate\",\"handoff_id\":\"{pending.HandoffId}\",\"session_id\":\"{pending.SessionId}\",\"slots\":{slots}}}";
}
