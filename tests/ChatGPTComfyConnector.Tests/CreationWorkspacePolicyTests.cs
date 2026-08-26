using ChatGPTComfyConnector.Core.Models;
using ChatGPTComfyConnector.Core.Services;

namespace ChatGPTComfyConnector.Tests;

public sealed class CreationWorkspacePolicyTests
{
    [Fact]
    public void SendRequiresAnExplicitlyActivatedBoundWorkspace()
    {
        var session = BoundSession();

        Assert.False(CreationWorkspacePolicy.CanSendToChatGpt(session, false, true, SlotDiscoveryState.Loaded, "idea", false));
        Assert.False(CreationWorkspacePolicy.CanSendToChatGpt(session, true, false, SlotDiscoveryState.Loaded, "idea", false));
        Assert.True(CreationWorkspacePolicy.CanSendToChatGpt(session, true, true, SlotDiscoveryState.Loaded, "idea", false));
    }

    [Fact]
    public void SendDoesNotRequireComfyUiToBeRunning()
    {
        var session = BoundSession();

        Assert.True(CreationWorkspacePolicy.CanSendToChatGpt(
            session,
            isSessionActivated: true,
            mcpConnected: true,
            slotDiscoveryState: SlotDiscoveryState.Loaded,
            idea: "ComfyUI may be stopped",
            isJobActive: false));
    }

    [Fact]
    public void SendRequiresIdeaSchemaAndIdleJob()
    {
        var session = BoundSession();

        Assert.False(CreationWorkspacePolicy.CanSendToChatGpt(session, true, true, SlotDiscoveryState.Loading, "idea", false));
        Assert.False(CreationWorkspacePolicy.CanSendToChatGpt(session, true, true, SlotDiscoveryState.Loaded, "  ", false));
        Assert.False(CreationWorkspacePolicy.CanSendToChatGpt(session, true, true, SlotDiscoveryState.Loaded, "idea", true));

        CreationPipelineStateMachine.BootstrapCopied(session, "already sent");
        Assert.False(CreationWorkspacePolicy.CanSendToChatGpt(session, true, true, SlotDiscoveryState.Loaded, "idea", false));
    }

    [Fact]
    public void FreshWorkspaceStartsAtConnectWithoutPersistedContent()
    {
        var persisted = BoundSession();
        persisted.OriginalIdea = "old idea";
        persisted.HandoffMessages.Add(new HandoffMessage { Title = "old handoff" });
        persisted.Iterations.Add(new SessionIteration { Number = 1 });

        var fresh = new CreationSession();
        CreationPipelineStateMachine.PrepareContext(fresh);

        Assert.Empty(fresh.OriginalIdea);
        Assert.Empty(fresh.HandoffMessages);
        Assert.Empty(fresh.Iterations);
        Assert.Equal(CreationStageState.Current, CreationPipelineStateMachine.Get(fresh, CreationStage.Connect).State);
        Assert.All(CreationPipelineStateMachine.OrderedStages.Skip(1), stage =>
            Assert.Equal(CreationStageState.NotReached, CreationPipelineStateMachine.Get(fresh, stage).State));
        Assert.NotSame(persisted, fresh);
    }

    private static CreationSession BoundSession()
    {
        var session = new CreationSession
        {
            BoundWorkflow = WorkflowIdentity.Create("test.json"),
            LocalProjectContextId = "project",
            LocalChatContextId = "chat",
            ProjectLabel = "Project",
            ChatLabel = "Chat",
            MaximumIterations = 10,
        };
        CreationPipelineStateMachine.PrepareContext(session);
        CreationPipelineStateMachine.SynchronizeConnectionGate(session, ConnectionState.Connected);
        CreationPipelineStateMachine.BindContext(session);
        return session;
    }
}
