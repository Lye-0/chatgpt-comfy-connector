using ChatGPTComfyConnector.Core.Models;

namespace ChatGPTComfyConnector.Core.Services;

/// <summary>
/// Identifies Handoff payloads that are already persisted and can be copied
/// without rebuilding the Handoff from mutable workspace state.
/// </summary>
public static class HandoffPayloadReuse
{
    public static bool TryGetSavedPayload(HandoffMessage? message, out string payload)
    {
        payload = message?.Payload ?? string.Empty;
        return !string.IsNullOrWhiteSpace(payload);
    }
}
