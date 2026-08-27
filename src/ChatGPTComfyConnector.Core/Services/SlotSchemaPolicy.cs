using System.Text.Json.Nodes;
using ChatGPTComfyConnector.Core.Models;

namespace ChatGPTComfyConnector.Core.Services;

/// <summary>
/// Canonical rules for Workflow slot schemas.
///
/// A slot address is the protocol identity of a slot.  Every layer that
/// handles a schema (discovery, Handoff creation, reuse checks, and command
/// validation) must therefore use the same case-insensitive comparer and must
/// never let duplicate addresses reach a dictionary or a Handoff body.
/// </summary>
public static class SlotSchemaPolicy
{
    public static StringComparer AddressComparer { get; } = StringComparer.OrdinalIgnoreCase;

    /// <summary>
    /// Canonicalizes a discovery result while preserving the source order.
    /// Exact duplicate records are collapsed defensively; records with the
    /// same address but different schema data are rejected because choosing a
    /// winner would make later slot writes ambiguous.
    /// </summary>
    public static IReadOnlyList<WorkflowSlot> NormalizeWorkflowSlots(IEnumerable<WorkflowSlot> slots)
    {
        ArgumentNullException.ThrowIfNull(slots);

        var result = new List<WorkflowSlot>();
        var byAddress = new Dictionary<string, WorkflowSlot>(AddressComparer);
        foreach (var slot in slots)
        {
            if (slot is null) throw new InvalidOperationException("Workflow Slot Schemaにnullのslotがあります。");
            var address = NormalizeAddress(slot.Address);
            if (byAddress.TryGetValue(address, out var existing))
            {
                if (WorkflowSlotsEquivalent(existing, slot)) continue;
                throw new InvalidOperationException($"Workflow Slot Schemaに競合するAddressがあります: {address}");
            }

            byAddress.Add(address, slot);
            result.Add(slot);
        }

        return result;
    }

    /// <summary>
    /// Creates the immutable ChatGPT-facing snapshots from one canonical
    /// Workflow schema.  This is the only supported factory path for a
    /// PendingHandoff's slot collection.
    /// </summary>
    public static IReadOnlyList<HandoffSlotSnapshot> CreateSnapshots(IEnumerable<WorkflowSlot> slots)
        => NormalizeWorkflowSlots(slots)
            .Select(ChatGptSlotPolicy.CreateSnapshot)
            .ToArray();

    public static bool WorkflowSlotsEquivalent(WorkflowSlot left, WorkflowSlot right)
    {
        ArgumentNullException.ThrowIfNull(left);
        ArgumentNullException.ThrowIfNull(right);
        return AddressComparer.Equals(NormalizeAddress(left.Address), NormalizeAddress(right.Address))
            && string.Equals(left.Label, right.Label, StringComparison.Ordinal)
            && string.Equals(left.Type, right.Type, StringComparison.Ordinal)
            && JsonEqual(left.CurrentValue, right.CurrentValue)
            && JsonEqual(left.Choices, right.Choices)
            && left.Minimum == right.Minimum
            && left.Maximum == right.Maximum
            && left.PairingSuspect == right.PairingSuspect;
    }

    /// <summary>
    /// Builds a validation-safe schema dictionary.  Unlike ToDictionary this
    /// method reports malformed Pending Handoffs as protocol validation errors
    /// instead of allowing an unhandled duplicate-key exception to escape.
    /// Identical duplicates are rejected too: a corrupted snapshot must not be
    /// silently accepted merely because its duplicate records happen to match.
    /// </summary>
    public static bool TryBuildSnapshotDictionary(
        IEnumerable<HandoffSlotSnapshot>? slots,
        out Dictionary<string, HandoffSlotSnapshot> schema,
        ICollection<string> errors)
    {
        ArgumentNullException.ThrowIfNull(errors);
        schema = new Dictionary<string, HandoffSlotSnapshot>(AddressComparer);
        var valid = true;
        if (slots is null)
        {
            errors.Add("Pending HandoffのSlot Schemaがありません。");
            return false;
        }

        foreach (var slot in slots)
        {
            if (slot is null)
            {
                errors.Add("Pending HandoffのSlot Schemaにnullのslotがあります。");
                valid = false;
                continue;
            }

            string address;
            try
            {
                address = NormalizeAddress(slot.Address);
            }
            catch (InvalidOperationException ex)
            {
                errors.Add(ex.Message);
                valid = false;
                continue;
            }

            if (schema.TryGetValue(address, out var existing))
            {
                var kind = SnapshotsEquivalent(existing, slot) ? "重複した" : "競合する";
                // Report the first-issued spelling as the canonical address so
                // a case-only duplicate has a stable, copyable diagnostic.
                errors.Add($"Pending HandoffのSlot Schemaに{kind}Addressがあります: {existing.Address.Trim()}");
                valid = false;
                continue;
            }

            schema.Add(address, slot);
        }

        return valid;
    }

    public static bool SnapshotsEquivalent(HandoffSlotSnapshot left, HandoffSlotSnapshot right)
    {
        ArgumentNullException.ThrowIfNull(left);
        ArgumentNullException.ThrowIfNull(right);
        return AddressComparer.Equals(NormalizeAddress(left.Address), NormalizeAddress(right.Address))
            && string.Equals(left.Label, right.Label, StringComparison.Ordinal)
            && string.Equals(left.Type, right.Type, StringComparison.Ordinal)
            && JsonEqual(left.CurrentValue, right.CurrentValue)
            && JsonEqual(left.Choices, right.Choices)
            && left.Minimum == right.Minimum
            && left.Maximum == right.Maximum
            && left.Transport == right.Transport
            && left.Exposure == right.Exposure
            && string.Equals(left.PolicyReason, right.PolicyReason, StringComparison.Ordinal);
    }

    /// <summary>
    /// Verifies that an issued snapshot can be rendered safely.  This keeps a
    /// malformed PendingHandoff from producing duplicate addresses in the
    /// copied Handoff text.
    /// </summary>
    public static IReadOnlyList<HandoffSlotSnapshot> RequireUniqueSnapshots(IEnumerable<HandoffSlotSnapshot>? slots)
    {
        var errors = new List<string>();
        if (!TryBuildSnapshotDictionary(slots, out var schema, errors))
            throw new InvalidOperationException(string.Join(" ", errors));
        return schema.Values.ToArray();
    }

    private static string NormalizeAddress(string? address)
    {
        var normalized = address?.Trim() ?? string.Empty;
        if (normalized.Length == 0) throw new InvalidOperationException("Workflow Slot Schemaに空のAddressがあります。");
        return normalized;
    }

    private static bool JsonEqual(JsonNode? left, JsonNode? right)
        => JsonNode.DeepEquals(left, right);
}
