using ChatGPTComfyConnector.Core.Models;

namespace ChatGPTComfyConnector.Core.Services;

/// <summary>
/// Policies that describe whether the current creation workspace may advance.
/// Keeping this decision in Core prevents the desktop view from inferring
/// readiness from button clicks or from a persisted session's contents.
/// </summary>
public static class CreationWorkspacePolicy
{
    /// <summary>
    /// Determines whether the initial context handoff may be sent to ChatGPT.
    /// The idea field is an optional kickoff instruction; an empty value means
    /// that the selected ChatGPT conversation should provide the creative context.
    /// ComfyUI runtime readiness is deliberately not part of this policy;
    /// only MCP connectivity and the context/session prerequisites are needed.
    /// </summary>
    public static bool CanSendToChatGpt(
        CreationSession? session,
        bool isSessionActivated,
        bool mcpConnected,
        SlotDiscoveryState slotDiscoveryState,
        string? idea,
        bool isJobActive)
    {
        if (!mcpConnected || !isSessionActivated || isJobActive ||
            slotDiscoveryState != SlotDiscoveryState.Loaded || session is null)
        {
            return false;
        }

        CreationPipelineStateMachine.EnsureInitialized(session);
        if (!CreationPipelineStateMachine.IsPreparationComplete(session))
        {
            return false;
        }

        return CreationPipelineStateMachine.Get(session, CreationStage.Idea).State is
            CreationStageState.Current or CreationStageState.WaitingUser;
    }
}
