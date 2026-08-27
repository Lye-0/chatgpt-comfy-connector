using ChatGPTComfyConnector.Core.Models;
using ChatGPTComfyConnector.Core.Services;

namespace ChatGPTComfyConnector.Infrastructure.Mcp;

/// <summary>
/// Lightweight direct health check for the ComfyUI HTTP endpoint. The shared
/// HttpClient avoids creating a socket pool for every five-second refresh and
/// the short timeout keeps the desktop UI responsive while ComfyUI is stopped
/// or still loading models.
/// </summary>
public sealed class ComfyUiEndpointHealthProbe : IComfyUiHealthProbe
{
    private static readonly HttpClient SharedHttpClient = CreateHttpClient();
    private readonly HttpClient _httpClient;

    public ComfyUiEndpointHealthProbe(HttpClient? httpClient = null)
        => _httpClient = httpClient ?? SharedHttpClient;

    public async Task<ComfyUiHealthCheckResult> CheckAsync(
        string endpoint,
        CancellationToken cancellationToken = default)
    {
        if (!TryBuildHealthUri(endpoint, out var healthUri))
        {
            return new(ComfyUiHealthCheckStatus.InvalidEndpoint, "Endpoint URLが不正です。");
        }

        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, healthUri);
            request.Headers.Accept.ParseAdd("application/json");
            using var response = await _httpClient.SendAsync(
                request,
                HttpCompletionOption.ResponseHeadersRead,
                cancellationToken).ConfigureAwait(false);

            if ((int)response.StatusCode is >= 200 and < 300)
            {
                return new(ComfyUiHealthCheckStatus.Ready);
            }

            return new(
                ComfyUiHealthCheckStatus.Unavailable,
                $"HTTP {(int)response.StatusCode} ({response.StatusCode})");
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            return new(ComfyUiHealthCheckStatus.Unavailable, "Endpointへの応答がタイムアウトしました。");
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (HttpRequestException ex)
        {
            return new(ComfyUiHealthCheckStatus.Unavailable, ex.Message);
        }
        catch (Exception ex)
        {
            return new(ComfyUiHealthCheckStatus.Error, ex.Message);
        }
    }

    private static HttpClient CreateHttpClient()
        => new()
        {
            Timeout = TimeSpan.FromSeconds(2),
        };

    private static bool TryBuildHealthUri(string endpoint, out Uri healthUri)
    {
        healthUri = default!;
        if (!Uri.TryCreate(endpoint?.Trim(), UriKind.Absolute, out var baseUri)
            || baseUri.Scheme is not ("http" or "https"))
        {
            return false;
        }

        var builder = new UriBuilder(baseUri)
        {
            Query = string.Empty,
            Fragment = string.Empty,
        };
        var path = builder.Path.TrimEnd('/');
        builder.Path = string.IsNullOrEmpty(path) ? "/system_stats" : $"{path}/system_stats";
        healthUri = builder.Uri;
        return true;
    }
}
