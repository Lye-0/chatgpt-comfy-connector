namespace ChatGPTComfyConnector.Desktop.ViewModels;

/// <summary>
/// Presentation projection of the persisted Core pipeline state.
/// </summary>
public sealed record CreationPipelineStage(
    int Number,
    string Key,
    string Label,
    string Description,
    string State,
    string StateLabel,
    bool IsLast)
{
    /// <summary>
    /// Presentation-only brush state. The persisted Core state remains
    /// INPROGRESS during automatic startup, while this projection lets the
    /// pipeline use the existing amber STARTING brush for that specific detail.
    /// </summary>
    public bool IsComfyUiStarting => State == "INPROGRESS"
        && Description.Contains("ComfyUI起動中", StringComparison.Ordinal);

    public string VisualState => IsComfyUiStarting ? "STARTING" : State;

    public string StateSymbol => State switch
    {
        "COMPLETED" => "✓",
        "ERROR" => "×",
        "WAITINGUSER" => "!",
        "INPROGRESS" => "◉",
        "CURRENT" => "●",
        "CANCELLED" or "SKIPPED" => "—",
        _ => "○",
    };

    public bool IsCurrent => State is "CURRENT" or "INPROGRESS";
    public bool IsInProgress => State == "INPROGRESS";
    public bool IsCompleted => State == "COMPLETED";
}
