using System.ComponentModel;
using System.Runtime.CompilerServices;
using ChatGPTComfyConnector.Core.Models;

namespace ChatGPTComfyConnector.Desktop.ViewModels;

public sealed class GenerationHistoryItem : INotifyPropertyChanged
{
    private bool _isLatest;
    private bool _isFinal;

    public GenerationHistoryItem(SessionIteration iteration)
    {
        Iteration = iteration;
        Iteration.PropertyChanged += Iteration_PropertyChanged;
    }

    public SessionIteration Iteration { get; }
    public int Number => Iteration.Number;
    public string Prompt => Iteration.Prompt;
    public string StatusText => Iteration.Status.ToString().ToUpperInvariant();
    public DateTimeOffset CreatedAt => Iteration.CreatedAt;
    public string CreatedAtText => Iteration.CreatedAt.ToLocalTime().ToString("yyyy/MM/dd HH:mm");
    public OutputArtifact? PrimaryOutput => Iteration.Outputs.FirstOrDefault();
    public bool HasOutput => PrimaryOutput is not null;
    public bool HasImage => PrimaryOutput?.IsImage == true;
    public bool HasVideo => PrimaryOutput?.IsVideo == true;
    public bool IsFailed => Iteration.Status == JobStatus.Failed;
    public bool IsLatest => _isLatest;
    public bool IsFinal => _isFinal;
    public bool HasBadge => IsLatest || IsFinal;
    public string BadgeText => IsFinal ? "FINAL" : IsLatest ? "LATEST" : string.Empty;

    public void UpdateFlags(bool isLatest, bool isFinal)
    {
        if (_isLatest == isLatest && _isFinal == isFinal) return;
        _isLatest = isLatest;
        _isFinal = isFinal;
        OnPropertyChanged(nameof(IsLatest));
        OnPropertyChanged(nameof(IsFinal));
        OnPropertyChanged(nameof(HasBadge));
        OnPropertyChanged(nameof(BadgeText));
    }

    private void Iteration_PropertyChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName == nameof(SessionIteration.Status))
        {
            OnPropertyChanged(nameof(StatusText));
            OnPropertyChanged(nameof(IsFailed));
        }

        if (e.PropertyName is nameof(SessionIteration.Outputs) or nameof(SessionIteration.HasOutputs))
        {
            OnPropertyChanged(nameof(PrimaryOutput));
            OnPropertyChanged(nameof(HasOutput));
            OnPropertyChanged(nameof(HasImage));
            OnPropertyChanged(nameof(HasVideo));
        }
    }

    public event PropertyChangedEventHandler? PropertyChanged;
    private void OnPropertyChanged([CallerMemberName] string? propertyName = null)
        => PropertyChanged?.Invoke(this, new(propertyName));
}
