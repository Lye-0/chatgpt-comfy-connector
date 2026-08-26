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
    /// Determines whether the initial idea handoff may be sent to ChatGPT.
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
            slotDiscoveryState != SlotDiscoveryState.Loaded ||
            string.IsNullOrWhiteSpace(idea) || session is null)
        {
            return false;
        }

        CreationPipelineStateMachine.EnsureInitialized(session);
        if (!session.Pipeline.ContextBound ||
            CreationPipelineStateMachine.Get(session, CreationStage.Context).State != CreationStageState.Completed)
        {
            return false;
        }

        return CreationPipelineStateMachine.Get(session, CreationStage.Idea).State is
            CreationStageState.Current or CreationStageState.WaitingUser;
    }
}
