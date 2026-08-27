using System.Net;
using ChatGPTComfyConnector.Core.Models;
using ChatGPTComfyConnector.Core.Services;
using ChatGPTComfyConnector.Infrastructure.Mcp;

namespace ChatGPTComfyConnector.Tests;

public sealed class ComfyUiRuntimeTests
{
    [Fact]
    public void RuntimeStateRemainsIndependentAndKeepsStartupPending()
    {
        Assert.Equal(
            ComfyUiRuntimeState.Stopped,
            ComfyUiRuntimeStateMachine.Resolve(
                ComfyUiRuntimeState.Unknown,
                new ComfyUiHealthCheckResult(ComfyUiHealthCheckStatus.Unavailable)));

        Assert.Equal(
            ComfyUiRuntimeState.Starting,
            ComfyUiRuntimeStateMachine.Resolve(
                ComfyUiRuntimeState.Starting,
                new ComfyUiHealthCheckResult(ComfyUiHealthCheckStatus.Unavailable)));

        Assert.Equal(
            ComfyUiRuntimeState.Ready,
            ComfyUiRuntimeStateMachine.Resolve(
                ComfyUiRuntimeState.Starting,
                new ComfyUiHealthCheckResult(ComfyUiHealthCheckStatus.Ready)));

        Assert.Equal(
            ComfyUiRuntimeState.Error,
            ComfyUiRuntimeStateMachine.Resolve(
                ComfyUiRuntimeState.Stopped,
                new ComfyUiHealthCheckResult(ComfyUiHealthCheckStatus.Error)));
    }

    [Fact]
    public async Task DirectProbeUsesConfiguredEndpointAndDoesNotNeedMcp()
    {
        Uri? requestedUri = null;
        using var client = new HttpClient(new StubHandler(request =>
        {
            requestedUri = request.RequestUri;
            return new HttpResponseMessage(HttpStatusCode.OK);
        }));
        var probe = new ComfyUiEndpointHealthProbe(client);

        var result = await probe.CheckAsync("http://127.0.0.1:8188");

        Assert.Equal(ComfyUiHealthCheckStatus.Ready, result.Status);
        Assert.Equal("http://127.0.0.1:8188/system_stats", requestedUri?.ToString());
    }

    [Fact]
    public async Task DirectProbeClassifiesUnavailableAndInvalidEndpoints()
    {
        using var unavailableClient = new HttpClient(new StubHandler(_ =>
            new HttpResponseMessage(HttpStatusCode.ServiceUnavailable)));
        var unavailable = await new ComfyUiEndpointHealthProbe(unavailableClient)
            .CheckAsync("http://127.0.0.1:8188");
        Assert.Equal(ComfyUiHealthCheckStatus.Unavailable, unavailable.Status);

        using var client = new HttpClient(new StubHandler(_ => new HttpResponseMessage(HttpStatusCode.OK)));
        var invalid = await new ComfyUiEndpointHealthProbe(client).CheckAsync("not-a-url");
        Assert.Equal(ComfyUiHealthCheckStatus.InvalidEndpoint, invalid.Status);
    }

    private sealed class StubHandler(Func<HttpRequestMessage, HttpResponseMessage> handler) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
            => Task.FromResult(handler(request));
    }
}
