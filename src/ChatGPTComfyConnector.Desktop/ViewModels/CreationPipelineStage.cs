namespace ChatGPTComfyConnector.Desktop.ViewModels;

/// <summary>
/// A presentation-only snapshot of one stage in the creation loop.
/// The underlying workflow/session models remain unchanged; this model keeps
/// the visual pipeline easy to extend without coupling it to WPF controls.
/// </summary>
public sealed record CreationPipelineStage(
    int Number,
    string Key,
    string Label,
    string Description,
    string State,
    string StateLabel,
    bool IsLast);
