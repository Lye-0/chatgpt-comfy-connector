using ChatGPTComfyConnector.Core.Models;

namespace ChatGPTComfyConnector.Core.Services;

/// <summary>
/// Compatibility and identity checks for an issued Pending Handoff.
///
/// A Pending Handoff is an immutable snapshot. These helpers decide whether
/// the current editor still describes that snapshot; they never mutate it or
/// generate a replacement ID.
/// </summary>
public static class PendingHandoffReuse
{
    public static string NormalizeKickoffInstruction(string? value)
        => (value ?? string.Empty).Replace("\r\n", "\n", StringComparison.Ordinal).Replace('\r', '\n');

    public static string GetKickoffInstruction(PendingHandoffSnapshot pending, CreationSession session)
        => pending.KickoffInstruction ?? session.OriginalIdea;

    public static bool MatchesBootstrap(
        CreationSession session,
        PendingHandoffSnapshot? pending,
        IEnumerable<WorkflowSlot> slots,
        string? kickoffInstruction)
    {
        if (pending is null || !IsBootstrap(pending)) return false;
        if (!string.Equals(pending.SessionId, session.Id, StringComparison.Ordinal)
            || !string.Equals(pending.WorkflowIdentity, session.BoundWorkflow?.RelativePath ?? string.Empty, StringComparison.OrdinalIgnoreCase)
            || !MatchesPersistedValue(pending.ContextProviderId, session.EffectiveContextProviderId)
            || !MatchesPersistedValue(pending.ProjectContextKey, session.EffectiveProjectContextKey)
            || !MatchesPersistedValue(pending.ChatContextKey, session.EffectiveChatContextKey)
            || !MatchesPersistedValue(pending.ProjectLabel, session.ProjectLabel)
            || !MatchesPersistedValue(pending.ChatLabel, session.ChatLabel)
            || pending.Iteration != session.CurrentIteration)
        {
            return false;
        }

        var issuedKickoff = GetKickoffInstruction(pending, session);
        if (!string.Equals(
                NormalizeKickoffInstruction(issuedKickoff),
                NormalizeKickoffInstruction(kickoffInstruction),
                StringComparison.Ordinal))
        {
            return false;
        }

        var current = SlotSchemaPolicy.CreateSnapshots(slots).ToArray();
        return pending.Slots.Count == current.Length
            && pending.Slots.Zip(current).All(pair => SlotSchemaPolicy.SnapshotsEquivalent(pair.First, pair.Second));
    }

    public static bool IsBootstrap(PendingHandoffSnapshot? pending)
        => pending is not null
            && !IsReview(pending)
            && pending.AllowedActions.Count == 1
            && pending.AllowedActions.Contains("generate", StringComparer.Ordinal);

    /// <summary>
    /// Identifies a response to a Review Handoff from the immutable snapshot
    /// that issued it.  Older snapshots did not persist a purpose field, so a
    /// review's distinct <c>complete</c> permission remains a safe migration
    /// fallback.  New snapshots always carry <see cref="PendingHandoffPurpose.Review"/>
    /// explicitly.
    /// </summary>
    public static bool IsReview(PendingHandoffSnapshot? pending)
        => pending is not null
            && (pending.Purpose == PendingHandoffPurpose.Review
                || (pending.Purpose == PendingHandoffPurpose.Unknown
                    && pending.AllowedActions.Contains("complete", StringComparer.Ordinal)));

    /// <summary>
    /// Confirms that a generated Bootstrap payload belongs to the currently
    /// pending snapshot. The fields are emitted as exact standalone lines by
    /// ConnectorContextBuilder, so a copied payload cannot be accidentally
    /// associated with a different snapshot.
    /// </summary>
    public static bool MatchesPayload(PendingHandoffSnapshot pending, string? payload)
    {
        if (string.IsNullOrWhiteSpace(payload)) return false;
        return HasField(payload, "handoff_id", pending.HandoffId)
            && HasField(payload, "session_id", pending.SessionId)
            && HasField(payload, "boundary_id", pending.BoundaryId);
    }

    private static bool HasField(string payload, string name, string value)
        => payload.Split(['\r', '\n'], StringSplitOptions.RemoveEmptyEntries)
            .Any(line => string.Equals(line.Trim(), $"{name}: {value}", StringComparison.Ordinal));

    private static bool MatchesPersistedValue(string? issued, string? current)
        // Empty values are absent in snapshots written before the context
        // identity fields were added; retain backward compatibility for those
        // records while enforcing exact matches for newly issued snapshots.
        => string.IsNullOrWhiteSpace(issued)
            || string.Equals(issued, current ?? string.Empty, StringComparison.Ordinal);
}
