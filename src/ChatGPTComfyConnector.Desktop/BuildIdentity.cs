using System.Reflection;

namespace ChatGPTComfyConnector.Desktop;

/// <summary>
/// Runtime build identity shown in the Desktop UI. Release/CI builds can
/// inject SourceRevisionId (or the generated RepositoryCommit metadata); a
/// local binary without repository metadata is explicitly shown as dev
/// instead of presenting a stale or fabricated hash.
/// </summary>
public static class BuildIdentity
{
    private static readonly Assembly Assembly = typeof(BuildIdentity).Assembly;

    public static string Version
    {
        get
        {
            var informational = Assembly
                .GetCustomAttribute<AssemblyInformationalVersionAttribute>()
                ?.InformationalVersion;
            if (!string.IsNullOrWhiteSpace(informational))
                return informational.Split('+', 2)[0];

            return Assembly.GetName().Version?.ToString(3) ?? "unknown";
        }
    }

    public static string Commit
    {
        get
        {
            var metadata = Assembly
                .GetCustomAttributes<AssemblyMetadataAttribute>()
                .FirstOrDefault(item => string.Equals(item.Key, "RepositoryCommit", StringComparison.Ordinal))
                ?.Value;
            var informational = Assembly
                .GetCustomAttribute<AssemblyInformationalVersionAttribute>()
                ?.InformationalVersion;
            var commit = !string.IsNullOrWhiteSpace(metadata)
                ? metadata
                : informational?.Split('+', 2).ElementAtOrDefault(1);
            if (string.IsNullOrWhiteSpace(commit)) return "dev";

            var normalized = commit.Trim();
            return normalized.Length <= 7 ? normalized : normalized[..7];
        }
    }

    public static string Display => $"v{Version} · {Commit}";
}
