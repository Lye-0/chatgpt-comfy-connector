using System.ComponentModel;
using System.Runtime.CompilerServices;
using System.Windows.Media.Imaging;
using ChatGPTComfyConnector.Core.Models;

namespace ChatGPTComfyConnector.Desktop.ViewModels;

public sealed class GenerationHistoryItem : INotifyPropertyChanged
{
    private bool _isLatest;
    private bool _isFinal;
    private BitmapSource? _thumbnailImage;
    private bool _thumbnailUnavailable;

    public GenerationHistoryItem(SessionIteration iteration)
    {
        Iteration = iteration;
        Iteration.PropertyChanged += Iteration_PropertyChanged;
    }

    public SessionIteration Iteration { get; }
    public int Number => Iteration.Number;
    public string Prompt => Iteration.Prompt;
    public string StatusText => Iteration.Status.ToString().ToUpperInvariant();
    public bool IsGenerating => Iteration.Status is JobStatus.Queued or JobStatus.Running;
    public string ActivityText => IsGenerating ? "GENERATING" : StatusText;
    public string StatusDetailText => Iteration.Status switch
    {
        JobStatus.Queued => "ComfyUIで生成準備中",
        JobStatus.Running => "ComfyUIで生成中",
        JobStatus.Completed => "生成が完了しました",
        JobStatus.Failed => "生成に失敗しました",
        JobStatus.Cancelled => "生成をキャンセルしました",
        _ => "Jobを確認してください",
    };
    public DateTimeOffset CreatedAt => Iteration.CreatedAt;
    public string CreatedAtText => Iteration.CreatedAt.ToLocalTime().ToString("yyyy/MM/dd HH:mm");
    public OutputArtifact? PrimaryOutput => Iteration.Outputs.FirstOrDefault();
    public BitmapSource? ThumbnailImage => _thumbnailImage;
    public bool HasThumbnail => _thumbnailImage is not null;
    public bool IsThumbnailUnavailable => _thumbnailUnavailable && !HasThumbnail;
    public bool ShowThumbnailMedia => HasVideo && !HasThumbnail && !IsThumbnailUnavailable;
    public bool ShowThumbnailUnavailable => HasVideo && IsThumbnailUnavailable;
    public bool HasOutput => PrimaryOutput is not null;
    public bool HasImage => !IsGenerating && PrimaryOutput?.IsImage == true;
    public bool HasVideo => !IsGenerating && PrimaryOutput?.IsVideo == true;
    public bool ShowNoOutput => !HasOutput && !IsGenerating;
    public bool IsFailed => Iteration.Status == JobStatus.Failed;
    public bool IsLatest => _isLatest;
    public bool IsFinal => _isFinal;
    public bool HasBadge => IsLatest || IsFinal;
    public string BadgeText => IsFinal ? "FINAL" : IsLatest ? "LATEST" : string.Empty;

    public void SetThumbnail(BitmapSource thumbnail)
    {
        if (thumbnail.CanFreeze && !thumbnail.IsFrozen) thumbnail.Freeze();
        _thumbnailImage = thumbnail;
        _thumbnailUnavailable = false;
        OnPropertyChanged(nameof(ThumbnailImage));
        OnPropertyChanged(nameof(HasThumbnail));
        OnPropertyChanged(nameof(IsThumbnailUnavailable));
        OnPropertyChanged(nameof(ShowThumbnailMedia));
        OnPropertyChanged(nameof(ShowThumbnailUnavailable));
    }

    public void MarkThumbnailUnavailable()
    {
        if (_thumbnailImage is not null || _thumbnailUnavailable) return;
        _thumbnailUnavailable = true;
        OnPropertyChanged(nameof(IsThumbnailUnavailable));
        OnPropertyChanged(nameof(ShowThumbnailMedia));
        OnPropertyChanged(nameof(ShowThumbnailUnavailable));
    }

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
            OnPropertyChanged(nameof(IsGenerating));
            OnPropertyChanged(nameof(ActivityText));
            OnPropertyChanged(nameof(StatusDetailText));
            OnPropertyChanged(nameof(IsFailed));
            OnPropertyChanged(nameof(HasImage));
            OnPropertyChanged(nameof(HasVideo));
            OnPropertyChanged(nameof(ShowNoOutput));
            OnPropertyChanged(nameof(ShowThumbnailMedia));
            OnPropertyChanged(nameof(ShowThumbnailUnavailable));
        }

        if (e.PropertyName is nameof(SessionIteration.Outputs) or nameof(SessionIteration.HasOutputs))
        {
            OnPropertyChanged(nameof(PrimaryOutput));
            OnPropertyChanged(nameof(HasOutput));
            OnPropertyChanged(nameof(HasImage));
            OnPropertyChanged(nameof(HasVideo));
            OnPropertyChanged(nameof(ShowNoOutput));
            OnPropertyChanged(nameof(ShowThumbnailMedia));
            OnPropertyChanged(nameof(ShowThumbnailUnavailable));
        }
    }

    public event PropertyChangedEventHandler? PropertyChanged;
    private void OnPropertyChanged([CallerMemberName] string? propertyName = null)
        => PropertyChanged?.Invoke(this, new(propertyName));
}
