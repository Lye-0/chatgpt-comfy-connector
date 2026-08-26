using ChatGPTComfyConnector.Core.Models;

namespace ChatGPTComfyConnector.Core.Services;

/// <summary>
/// Maps direct ComfyUI health observations to the single runtime state used by
/// the desktop header. A failed launch remains visible as ERROR until a later
/// successful probe or an endpoint change resets the state; a normal
/// unavailable probe is STOPPED, while an explicitly requested startup remains
/// STARTING until the endpoint responds.
/// </summary>
public static class ComfyUiRuntimeStateMachine
{
    public static ComfyUiRuntimeState Resolve(
        ComfyUiRuntimeState current,
        ComfyUiHealthCheckResult health)
        => health.Status switch
        {
            ComfyUiHealthCheckStatus.Ready => ComfyUiRuntimeState.Ready,
            ComfyUiHealthCheckStatus.InvalidEndpoint or ComfyUiHealthCheckStatus.Error => ComfyUiRuntimeState.Error,
            ComfyUiHealthCheckStatus.Unavailable when current is ComfyUiRuntimeState.Starting or ComfyUiRuntimeState.Error => current,
            ComfyUiHealthCheckStatus.Unavailable => ComfyUiRuntimeState.Stopped,
            _ => ComfyUiRuntimeState.Unknown,
        };
}
