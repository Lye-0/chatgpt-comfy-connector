using ChatGPTComfyConnector.Core.Models;

namespace ChatGPTComfyConnector.Core.Services;

/// <summary>
/// Defines the durable identity used when a timeline record is updated by a
/// later phase of the same transport. Incoming complete Responses are
/// identified by their exact payload (which carries the protocol identity), so
/// an optional iteration projection must not create a second card.
/// </summary>
public static class HandoffMessageIdentity
{
    public static bool Matches(HandoffMessage existing, HandoffMessage candidate)
    {
        if (existing.Direction != candidate.Direction
            || existing.Kind != candidate.Kind
            || !string.Equals(existing.Payload, candidate.Payload, StringComparison.Ordinal))
        {
            return false;
        }

        return IsIncomingComplete(existing)
            || existing.IterationNumber == candidate.IterationNumber;
    }

    private static bool IsIncomingComplete(HandoffMessage message)
        => message.Direction == HandoffDirection.ChatGptToComfy
            && message.Kind == HandoffMessageKind.Complete;
}
