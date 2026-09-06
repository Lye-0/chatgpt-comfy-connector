using System.Text.Json;
using ChatGPTComfyConnector.Core.Models;
using ChatGPTComfyConnector.Core.Services;

namespace ChatGPTComfyConnector.Tests;

public sealed class CreationGuidanceTests
{
    [Fact]
    public void FirstCreationGuidesConnectionWorkflowRefreshAndBothSelectionConfirmations()
    {
        var input = Draft() with { Connection = ConnectionState.Disconnected, Workflow = new(null, SlotDiscoveryState.NotLoaded) };
        AssertTarget(input, CreationGuideTarget.Connect);
        AssertTarget(input with { Connection = ConnectionState.Connecting }, CreationGuideTarget.None);
        input = input with { Connection = ConnectionState.Connected };
        AssertTarget(input, CreationGuideTarget.WorkflowLibrary);
        AssertTarget(input with { Workflow = new(Workflow(), SlotDiscoveryState.Loading) }, CreationGuideTarget.None);
        input = input with { Workflow = new(Workflow(), SlotDiscoveryState.Loaded) };
        // A valid cached Project/Chat is not evidence of a user refresh.
        AssertTarget(input, CreationGuideTarget.ChatReload);
        AssertTarget(input with { Chat = input.Chat with { CatalogState = ProjectChatCatalogLoadState.Loading } }, CreationGuideTarget.None);
        input = input with { IsCatalogRefreshed = true };
        AssertTarget(input, CreationGuideTarget.ProjectSelector);
        input = input with { IsProjectConfirmed = true };
        AssertTarget(input with { Chat = input.Chat with { IsLoadingChats = true } }, CreationGuideTarget.None);
        AssertTarget(input, CreationGuideTarget.ChatSelector);
        input = input with { IsChatConfirmed = true, CanStartCreation = true };
        AssertTarget(input, CreationGuideTarget.NewCreation);
        AssertTarget(input with { Chat = input.Chat with { MaximumIterations = 0 } }, CreationGuideTarget.MaximumIterations);
        AssertTarget(input with { HasMaximumIterationsInputError = true }, CreationGuideTarget.MaximumIterations);
        AssertTarget(input with { Session = Bound(), IsSessionActivated = true, CanSend = true }, CreationGuideTarget.SendToChatGpt);
    }

    [Fact]
    public void ConfirmationKeepsSameSelectionButNeverLeaksToAnotherProjectOrRefresh()
    {
        var progress = new ChatGuidanceProgress();
        progress.Refreshed();
        progress.ConfirmProject("provider/project");
        progress.ConfirmChat("provider/project", "chat");
        progress.SelectionChanged("provider/project", "chat");
        Assert.True(progress.IsChatConfirmed("provider/project", "chat"));
        progress.ConfirmProject("provider/project");
        Assert.True(progress.IsChatConfirmed("provider/project", "chat"));
        progress.SelectionChanged("provider/other-project", "chat");
        Assert.False(progress.IsProjectConfirmed("provider/other-project"));
        Assert.False(progress.IsChatConfirmed("provider/other-project", "chat"));
        progress.ConfirmChat("provider/other-project", "chat");
        progress.Reset();
        Assert.False(progress.CatalogRefreshed);
        Assert.False(progress.IsProjectConfirmed("provider/other-project"));
        progress.Refreshed();
        Assert.False(progress.IsChatConfirmed("provider/other-project", "chat"));
    }

    [Fact]
    public void ChatAndWorkflowRecoveryGuideOnlyAnAvailableRecoveryControl()
    {
        var input = Draft() with { Workflow = new(Workflow(), SlotDiscoveryState.Failed, "schema failure") };
        AssertTarget(input, CreationGuideTarget.WorkflowSettings);
        AssertTarget(input with { IsWorkflowEditorVisible = true }, CreationGuideTarget.WorkflowRetry);
        input = Draft() with { IsCatalogRefreshed = true, IsProjectConfirmed = true, IsChatConfirmed = true };
        input = input with { Chat = input.Chat with { Error = "project chats failed" } };
        AssertTarget(input, CreationGuideTarget.ChatReload);
        AssertTarget(input with { CanRefreshChat = false }, CreationGuideTarget.None);
        AssertTarget(input with { IsExtensionConnected = false }, CreationGuideTarget.ExtensionConnection);
        AssertTarget(Draft() with { RequiresChatRefresh = false }, CreationGuideTarget.ProjectSelector);
    }

    [Fact]
    public void AutomaticResponseAndGenerationNeverAskForDuplicateApplyOrGenerate()
    {
        var session = Bound();
        var input = Active(session) with { CanSend = true, CanApply = true, CanGenerate = true };
        CreationPipelineStateMachine.BootstrapSent(session, "");
        AssertTarget(input, CreationGuideTarget.None);
        CreationPipelineStateMachine.BeginCommandValidation(session);
        AssertTarget(input, CreationGuideTarget.None);
        CreationPipelineStateMachine.CommandValidated(session, "generate");
        session.Pipeline.AutomaticResponseExecution = new() { State = AutomaticResponseExecutionState.Applying };
        AssertTarget(input, CreationGuideTarget.None);
        CreationPipelineStateMachine.BeginApply(session);
        AssertTarget(input, CreationGuideTarget.None);
        CreationPipelineStateMachine.ApplyCompleted(session);
        AssertTarget(input, CreationGuideTarget.None);
        CreationPipelineStateMachine.BeginGenerate(session);
        AssertTarget(input, CreationGuideTarget.None);
        CreationPipelineStateMachine.JobStatusChanged(session, JobStatus.Completed);
        AssertTarget(input, CreationGuideTarget.None);
    }

    [Fact]
    public void ManualHandoffGuidesPasteThenValidationAndExecution()
    {
        var session = Bound();
        CreationPipelineStateMachine.BootstrapCopied(session, "");
        var input = Active(session) with { HandoffNeedsPaste = true, HandoffItemId = "outgoing-card" };
        var guide = CreationGuidancePolicy.Resolve(input);
        Assert.Equal(CreationGuideTarget.Handoff, guide.Target);
        Assert.Equal("outgoing-card", guide.ItemId);
        input = input with { HasCommandText = true };
        AssertTarget(input, CreationGuideTarget.ImportCommand);
        CreationPipelineStateMachine.BeginCommandValidation(session);
        AssertTarget(input, CreationGuideTarget.None);
        CreationPipelineStateMachine.CommandValidated(session, "generate");
        input = input with { IsCommandValid = true, HasCommandText = false, HandoffNeedsPaste = false };
        AssertTarget(input, CreationGuideTarget.None);
        input = input with { CanApply = true };
        AssertTarget(input, CreationGuideTarget.ApplyGenerate);
        CreationPipelineStateMachine.ApplyCompleted(session);
        input = input with { CanApply = false, CanGenerate = true };
        AssertTarget(input, CreationGuideTarget.Generate);
        Assert.Throws<InvalidOperationException>(() => CreationPipelineStateMachine.RequireComfyUi(session, CreationStage.Generate, false));
        AssertTarget(input, CreationGuideTarget.StartComfyUi);
    }

    [Fact]
    public void FailedCommandRequiresCorrectionAndApplyFailureRequiresWorkflowInspection()
    {
        var session = Bound();
        CreationPipelineStateMachine.BootstrapSent(session, "");
        CreationPipelineStateMachine.CommandValidationFailed(session, "invalid response");
        var input = Active(session) with { HasCommandText = true };
        AssertTarget(input, CreationGuideTarget.CommandInput);
        CreationPipelineStateMachine.CommandValidated(session, "generate");
        CreationPipelineStateMachine.ApplyFailed(session, "fingerprint changed");
        input = input with { HasCommandText = false, IsCommandValid = true };
        AssertTarget(input, CreationGuideTarget.WorkflowSettings);
        AssertTarget(input with { IsWorkflowEditorVisible = true }, CreationGuideTarget.WorkflowEditor);
    }

    [Fact]
    public void ReviewRecoveryDoesNotSuggestRegenerationAndLimitOffersAChoice()
    {
        var session = Bound();
        CreationPipelineStateMachine.BootstrapSent(session, "");
        session.Pipeline.ReviewMediaAttachment = new() { State = ReviewMediaAttachmentState.Failed };
        var input = Active(session) with { CanAttachReviewOutput = true };
        AssertTarget(input, CreationGuideTarget.AttachReviewOutput);
        AssertTarget(input with { IsExtensionConnected = false }, CreationGuideTarget.ExtensionConnection);
        session.Pipeline.ReviewMediaAttachment = null;
        CreationPipelineStateMachine.ReviewHandoffFailed(session, "send_failed", "test", "failed");
        AssertTarget(input with { CanSend = true }, CreationGuideTarget.SendToChatGpt);
        session.Pipeline.MaximumIterationSafetyStop = true;
        AssertTarget(input, CreationGuideTarget.IterationDecision);
        session.Status = SessionStatus.Completed;
        AssertTarget(input, CreationGuideTarget.None);
    }

    [Fact]
    public void GuidanceIsReadOnlyAndStopsForActionsInProgress()
    {
        var session = Bound();
        var before = JsonSerializer.Serialize(session);
        var input = Active(session) with { CanSend = true };
        AssertTarget(input, CreationGuideTarget.SendToChatGpt);
        AssertTarget(input with { IsOperationInProgress = true }, CreationGuideTarget.None);
        AssertTarget(input with { Connection = ConnectionState.Disconnected }, CreationGuideTarget.Connect);
        Assert.Equal(before, JsonSerializer.Serialize(session));
    }

    private static WorkflowIdentity Workflow() => WorkflowIdentity.Create("test.json");
    private static CreationGuideContext Draft() => new()
    {
        Connection = ConnectionState.Connected,
        Workflow = new(Workflow(), SlotDiscoveryState.Loaded),
        Chat = new(ProjectChatCatalogLoadState.Loaded,
            new() { ProviderId = ContextProviderIds.LocalJson, Key = "project" },
            new() { ProviderId = ContextProviderIds.LocalJson, ProjectKey = "project", Key = "chat" }, 2),
        IsExtensionConnected = true, CanRefreshChat = true,
    };
    private static CreationSession Bound()
    {
        var session = new CreationSession { LocalProjectContextId = "project", LocalChatContextId = "chat" };
        CreationPipelineStateMachine.SynchronizeConnectionGate(session, ConnectionState.Connected);
        CreationPipelineStateMachine.BindWorkflow(session, Workflow(), SlotDiscoveryState.Loaded);
        CreationPipelineStateMachine.BindChat(session);
        return session;
    }
    private static CreationGuideContext Active(CreationSession session) => Draft() with { Session = session, IsSessionActivated = true };
    private static void AssertTarget(CreationGuideContext context, CreationGuideTarget expected)
        => Assert.Equal(expected, CreationGuidancePolicy.Resolve(context).Target);
}
