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
