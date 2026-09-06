using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using ChatGPTComfyConnector.Core.Models;
using ChatGPTComfyConnector.Core.Services;
using ChatGPTComfyConnector.Infrastructure.Storage;

namespace ChatGPTComfyConnector.Tests;

public sealed class CreationPreparationTests
{
    private static readonly WorkflowIdentity Workflow = WorkflowIdentity.Create("test.json");
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        Converters = { new JsonStringEnumConverter() },
    };

    [Fact]
    public void PipelineHasSeparateWorkflowAndChatInExecutionOrder()
    {
        Assert.Equal(new[] { CreationStage.Connect, CreationStage.Workflow, CreationStage.Chat,
            CreationStage.Idea, CreationStage.ToChatGpt, CreationStage.Command, CreationStage.Apply,
            CreationStage.Generate, CreationStage.Output, CreationStage.Review }, CreationPipelineStateMachine.OrderedStages);
        Assert.Equal(0, (int)CreationStage.Context);
        Assert.Equal(5, (int)CreationStage.Generate);
        Assert.Equal(8, (int)CreationStage.Connect);
    }

    [Theory]
    [InlineData(SlotDiscoveryState.NotLoaded, CreationStageState.Current)]
    [InlineData(SlotDiscoveryState.Loading, CreationStageState.InProgress)]
    [InlineData(SlotDiscoveryState.Failed, CreationStageState.Error)]
    [InlineData(SlotDiscoveryState.Loaded, CreationStageState.Completed)]
    public void WorkflowReadinessTracksSchemaLifecycle(SlotDiscoveryState slots, CreationStageState expected)
    {
        var session = Draft();
        Sync(session, new(Workflow, slots), ReadyChat());
        AssertStage(session, CreationStage.Workflow, expected);
        AssertStage(session, CreationStage.Chat, slots == SlotDiscoveryState.Loaded ? CreationStageState.Current : CreationStageState.NotReached);
        AssertStage(session, CreationStage.Idea, CreationStageState.NotReached);
        Assert.False(session.Pipeline.IsPreparationBound);
    }

    [Theory]
    [InlineData(ProjectChatCatalogLoadState.NotLoaded, CreationStageState.Current)]
    [InlineData(ProjectChatCatalogLoadState.Loading, CreationStageState.InProgress)]
    [InlineData(ProjectChatCatalogLoadState.Error, CreationStageState.Error)]
    [InlineData(ProjectChatCatalogLoadState.Disconnected, CreationStageState.WaitingUser)]
    [InlineData(ProjectChatCatalogLoadState.Loaded, CreationStageState.Current)]
    public void ChatAcquisitionDoesNotInvalidateReadyWorkflow(ProjectChatCatalogLoadState catalog, CreationStageState expected)
    {
        var session = Draft();
        Sync(session, new(Workflow, SlotDiscoveryState.Loaded), ReadyChat() with { CatalogState = catalog });
        AssertStage(session, CreationStage.Workflow, CreationStageState.Completed);
        AssertStage(session, CreationStage.Chat, expected);
        AssertStage(session, CreationStage.Idea, CreationStageState.NotReached);
    }

    [Fact]
    public void EmptyCatalogAndUnselectedWorkflowAreNotErrorsOrCompletion()
    {
        Assert.Equal(CreationStageState.Current, CreationPreparationPolicy.EvaluateWorkflow(new(null, SlotDiscoveryState.Loaded)).State);
        Assert.Equal(CreationStageState.Current, CreationPreparationPolicy.EvaluateChat(new(ProjectChatCatalogLoadState.Empty, null, null, 2)).State);
        var session = Draft();
        Sync(session, new(null, SlotDiscoveryState.Failed, "Workflow読込エラー"), ReadyChat());
        AssertStage(session, CreationStage.Workflow, CreationStageState.Error);
        AssertStage(session, CreationStage.Chat, CreationStageState.NotReached);
        Assert.Contains("Workflow読込エラー", Stage(session, CreationStage.Workflow).Detail);
    }

    [Fact]
    public void ChatSelectionLoadingFailureAndRetryStayInChat()
    {
        var session = Draft();
        var workflow = new WorkflowPreparation(Workflow, SlotDiscoveryState.Loaded);
        Sync(session, workflow, ReadyChat() with { IsLoadingChats = true, Chat = null });
        AssertStage(session, CreationStage.Chat, CreationStageState.InProgress);
        Assert.Contains("CHAT", CreationPipelineLoopText.Resolve(session, false, ConnectionState.Connected, null));
        Sync(session, workflow, ReadyChat() with { Chat = null, Error = "選択ProjectのChat取得に失敗" });
        AssertStage(session, CreationStage.Chat, CreationStageState.Error);
        AssertStage(session, CreationStage.Workflow, CreationStageState.Completed);
        Sync(session, workflow, ReadyChat());
        AssertStage(session, CreationStage.Chat, CreationStageState.Current);
        Assert.DoesNotContain("失敗", Stage(session, CreationStage.Chat).Detail);
    }

    [Fact]
    public void PreparationDoesNotAdvanceBeforeConnectionOrWorkflow()
    {
        var session = Draft(ConnectionState.Disconnected);
        Sync(session, new(Workflow, SlotDiscoveryState.Loaded), ReadyChat());
        AssertStage(session, CreationStage.Workflow, CreationStageState.NotReached);
        AssertStage(session, CreationStage.Chat, CreationStageState.NotReached);
        CreationPipelineStateMachine.SynchronizeConnectionGate(session, ConnectionState.Connected);
        Sync(session, new(Workflow, SlotDiscoveryState.Loading), ReadyChat());
        AssertStage(session, CreationStage.Chat, CreationStageState.NotReached);
        Sync(session, new(Workflow, SlotDiscoveryState.Loaded), ReadyChat());
        AssertStage(session, CreationStage.Workflow, CreationStageState.Completed);
        AssertStage(session, CreationStage.Chat, CreationStageState.Current);
        Assert.False(CreationWorkspacePolicy.CanSendToChatGpt(session, false, true, SlotDiscoveryState.Loaded, null, false));
    }

    [Fact]
    public void ErrorsRetainTheirOwnerEvenWhenDiscoveryRunsBeforeItsTurn()
    {
        var session = Draft();
        Sync(session, new(Workflow, SlotDiscoveryState.Loading), ReadyChat() with { Error = "chat failure" });
        AssertStage(session, CreationStage.Workflow, CreationStageState.InProgress);
        AssertStage(session, CreationStage.Chat, CreationStageState.Error);
        Sync(session, new(Workflow, SlotDiscoveryState.Failed, "schema failure"), ReadyChat());
        Assert.Contains("schema failure", Stage(session, CreationStage.Workflow).Detail);
        AssertStage(session, CreationStage.Chat, CreationStageState.NotReached);
    }

    [Fact]
    public void ChatReadinessRejectsWrongProviderProjectAndUnsafeNewChat()
    {
        var ready = ReadyChat();
        ready.Chat!.ProjectKey = "another-project";
        Assert.Equal(CreationStageState.Error, CreationPreparationPolicy.EvaluateChat(ready).State);
        ready = ReadyChat();
        ready.Chat!.ProviderId = "another-provider";
        Assert.Equal(CreationStageState.Error, CreationPreparationPolicy.EvaluateChat(ready).State);
        ready = ReadyChat();
        ready.Project!.Mode = ContextBindingMode.External;
        Assert.Equal(CreationStageState.Error, CreationPreparationPolicy.EvaluateChat(ready).State);
        ready.Project.ExternalId = "g-p-example";
        ready.Chat!.IsNewConversation = true;
        Assert.Equal(CreationStageState.Error, CreationPreparationPolicy.EvaluateChat(ready).State);
        ready.Project.Url = "https://chatgpt.com/g/g-p-example/project";
        Assert.Equal(CreationStageState.Completed, CreationPreparationPolicy.EvaluateChat(ready).State);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(1001)]
    public void ChatOwnsTheCreationBudgetValidation(int maximum)
        => Assert.Equal(CreationStageState.Error, CreationPreparationPolicy.EvaluateChat(ReadyChat() with { MaximumIterations = maximum }).State);

    [Fact]
    public void WorkflowAndChatBindSeparatelyAndBothAreRequiredForIdea()
    {
        var session = Draft();
        session.BoundWorkflow = Workflow;
        session.LocalProjectContextId = "project";
        session.LocalChatContextId = "chat";
        Assert.Throws<InvalidOperationException>(() => CreationPipelineStateMachine.BindChat(session));
        Assert.Throws<InvalidOperationException>(() => CreationPipelineStateMachine.BindWorkflow(session, Workflow, SlotDiscoveryState.Loading));
        CreationPipelineStateMachine.BindWorkflow(session, Workflow, SlotDiscoveryState.Loaded);
        Assert.True(session.Pipeline.WorkflowBound);
        Assert.False(session.Pipeline.ChatBound);
        AssertStage(session, CreationStage.Chat, CreationStageState.Current);
        Assert.Throws<InvalidOperationException>(() => CreationPipelineStateMachine.BootstrapCopied(session, ""));
        CreationPipelineStateMachine.BindChat(session);
        Assert.True(CreationPipelineStateMachine.IsPreparationComplete(session));
        AssertStage(session, CreationStage.Idea, CreationStageState.Current);
        Assert.True(CreationWorkspacePolicy.CanSendToChatGpt(session, true, true, SlotDiscoveryState.Loaded, "", false));
        Stage(session, CreationStage.Workflow).State = CreationStageState.Error;
        Assert.False(CreationWorkspacePolicy.CanSendToChatGpt(session, true, true, SlotDiscoveryState.Loaded, "", false));
        Assert.Throws<InvalidOperationException>(() => CreationPipelineStateMachine.BeginCommandValidation(session));
    }

    [Fact]
    public void BindingSaveFailureBlocksIdeaAndCanRetryWithoutReloadingWorkflow()
    {
        var session = Bound();
        var workflow = Stage(session, CreationStage.Workflow);
        session.PendingHandoff = PendingHandoffFactory.Create(session, [], "generate");
        CreationPipelineStateMachine.ChatBindingFailed(session, "disk full");
        AssertStage(session, CreationStage.Chat, CreationStageState.Error);
        AssertStage(session, CreationStage.Workflow, CreationStageState.Completed);
        AssertStage(session, CreationStage.Idea, CreationStageState.NotReached);
        Assert.False(session.Pipeline.ChatBound);
        Assert.Null(session.PendingHandoff);
        Assert.False(CreationWorkspacePolicy.CanSendToChatGpt(session, true, true, SlotDiscoveryState.Loaded, "", false));
        CreationPipelineStateMachine.BindChat(session);
        Assert.Same(workflow, Stage(session, CreationStage.Workflow));
        AssertStage(session, CreationStage.Chat, CreationStageState.Completed);
        AssertStage(session, CreationStage.Idea, CreationStageState.Current);
    }

    [Fact]
    public void DraftChangesNeverRetargetBoundSessionOrResetDownstreamProgress()
    {
        var session = Bound();
        session.PendingHandoff = PendingHandoffFactory.Create(session, [], "generate");
        CreationPipelineStateMachine.BootstrapSent(session, "");
        var pending = session.PendingHandoff;
        var sent = Stage(session, CreationStage.ToChatGpt);
        var sentAt = sent.UpdatedAt;
        Sync(session, new(WorkflowIdentity.Create("other.json"), SlotDiscoveryState.Failed), ReadyChat() with { Error = "draft error" });
        Assert.True(CreationPipelineStateMachine.IsPreparationComplete(session));
        Assert.Same(Workflow, session.BoundWorkflow);
        Assert.Same(pending, session.PendingHandoff);
        Assert.Equal(sentAt, sent.UpdatedAt);
        CreationPipelineStateMachine.SynchronizeConnectionGate(session, ConnectionState.Disconnected);
        AssertStage(session, CreationStage.Connect, CreationStageState.WaitingUser);
        AssertStage(session, CreationStage.Workflow, CreationStageState.Completed);
        AssertStage(session, CreationStage.Chat, CreationStageState.Completed);
        CreationPipelineStateMachine.SynchronizeConnectionGate(session, ConnectionState.Connected);
        Assert.Same(pending, session.PendingHandoff);
        Assert.Equal(sentAt, sent.UpdatedAt);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task LegacyBoundSnapshotMigratesStringAndNumericStagesAndRoundTrips(bool numeric)
    {
        var session = Bound();
        session.PendingHandoff = PendingHandoffFactory.Create(session, [], "generate");
        CreationPipelineStateMachine.BootstrapSent(session, "");
        session.Pipeline.CurrentRun!.Number = 3;
        var pendingId = session.PendingHandoff.HandoffId;
        var expectedSent = Stage(session, CreationStage.ToChatGpt);
        var json = JsonSerializer.SerializeToNode(session, JsonOptions)!;
        var pipeline = json["pipeline"]!;
        pipeline["version"] = 7;
        pipeline["contextBound"] = true;
        pipeline.AsObject().Remove("workflowBound");
        pipeline.AsObject().Remove("chatBound");
        var stages = pipeline["stages"]!.AsArray();
        stages.Remove(stages.Single(item => item!["stage"]!.GetValue<string>() == "Chat"));
        stages.Single(item => item!["stage"]!.GetValue<string>() == "Workflow")!["stage"] = "Context";
        if (numeric)
            foreach (var stage in stages) stage!["stage"] = (int)Enum.Parse<CreationStage>(stage["stage"]!.GetValue<string>());

        var restored = json.Deserialize<CreationSession>(JsonOptions)!;
        CreationPipelineStateMachine.EnsureInitialized(restored);
        Assert.Equal(8, restored.Pipeline.Version);
        Assert.True(CreationPipelineStateMachine.IsPreparationComplete(restored));
        Assert.DoesNotContain(restored.Pipeline.Stages, item => item.Stage == CreationStage.Context);
        Assert.Equal(10, restored.Pipeline.Stages.Count);
        Assert.Equal(pendingId, restored.PendingHandoff!.HandoffId);
        Assert.Equal(3, restored.Pipeline.CurrentRun!.Number);
        Assert.Equal(expectedSent.State, Stage(restored, CreationStage.ToChatGpt).State);
        Assert.Equal(expectedSent.UpdatedAt, Stage(restored, CreationStage.ToChatGpt).UpdatedAt);
        var first = JsonSerializer.Serialize(restored, JsonOptions);
        CreationPipelineStateMachine.EnsureInitialized(restored);
        Assert.Equal(first, JsonSerializer.Serialize(restored, JsonOptions));
        Assert.DoesNotContain("contextBound", first);

        var temp = Path.Combine(Path.GetTempPath(), "connector-split-pipeline-" + Guid.NewGuid().ToString("N"));
        try
        {
            var store = new PortableStore(new PortableLayout(temp));
            await store.SaveSessionAsync(restored);
            var loaded = Assert.Single(await store.LoadSessionsAsync());
            Assert.True(CreationPipelineStateMachine.IsPreparationComplete(loaded));
            Assert.Equal(pendingId, loaded.PendingHandoff!.HandoffId);
            Assert.Equal(3, loaded.Pipeline.CurrentRun!.Number);
        }
        finally { if (Directory.Exists(temp)) Directory.Delete(temp, true); }
    }

    [Fact]
    public void UnfinishedLegacyContextDoesNotInventWorkflowOrChatCompletion()
    {
        var session = Draft();
        session.Pipeline.Version = 7;
        session.Pipeline.Stages.Add(new() { Stage = CreationStage.Context, State = CreationStageState.Error, Detail = "legacy failure" });
        CreationPipelineStateMachine.EnsureInitialized(session);
        AssertStage(session, CreationStage.Workflow, CreationStageState.Current);
        AssertStage(session, CreationStage.Chat, CreationStageState.NotReached);
        Assert.False(session.Pipeline.IsPreparationBound);
    }

    [Fact]
    public void SessionWithoutPersistedPipelineCanRestoreButNewConfiguredSessionCannotSkipBinding()
    {
        var session = new CreationSession { BoundWorkflow = Workflow, LocalProjectContextId = "project", LocalChatContextId = "chat" };
        CreationPipelineStateMachine.EnsureInitialized(session);
        Assert.False(session.Pipeline.IsPreparationBound);
        var json = JsonSerializer.SerializeToNode(session, JsonOptions)!.AsObject();
        json.Remove("pipeline");
        var legacy = json.Deserialize<CreationSession>(JsonOptions)!;
        Assert.True(CreationPipelineStateMachine.IsPreparationComplete(legacy));
        AssertStage(legacy, CreationStage.Connect, CreationStageState.Current);
    }

    private static CreationSession Draft(ConnectionState connection = ConnectionState.Connected)
    {
        var session = new CreationSession();
        CreationPipelineStateMachine.PrepareCreation(session);
        CreationPipelineStateMachine.SynchronizeConnectionGate(session, connection);
        return session;
    }

    private static CreationSession Bound()
    {
        var session = Draft();
        CreationPipelineStateMachine.BindWorkflow(session, Workflow, SlotDiscoveryState.Loaded);
        session.LocalProjectContextId = "project";
        session.LocalChatContextId = "chat";
        CreationPipelineStateMachine.BindChat(session);
        return session;
    }

    private static ChatPreparation ReadyChat() => new(ProjectChatCatalogLoadState.Loaded,
        new() { ProviderId = ContextProviderIds.LocalJson, Key = "project" },
        new() { ProviderId = ContextProviderIds.LocalJson, ProjectKey = "project", Key = "chat" }, 2);
    private static void Sync(CreationSession session, WorkflowPreparation workflow, ChatPreparation chat)
        => CreationPipelineStateMachine.SynchronizePreparation(session, workflow, chat);
    private static CreationStageStatus Stage(CreationSession session, CreationStage stage)
        => CreationPipelineStateMachine.Get(session, stage);
    private static void AssertStage(CreationSession session, CreationStage stage, CreationStageState expected)
        => Assert.Equal(expected, Stage(session, stage).State);
}
