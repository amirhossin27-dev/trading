using Standalone.Api.Services;
namespace Standalone.Api;
public static class Endpoints {
 public static IEndpointRouteBuilder MapPublicData(this IEndpointRouteBuilder app) {
        var trading = app.MapGroup("/api/trading").WithTags("Trading");

        trading.MapGet("/search", (string? q, MarketDataService service, CancellationToken cancellationToken) =>
            Run(async () => Results.Ok(await service.SearchAsync(q ?? string.Empty, cancellationToken))));

        trading.MapGet("/quotes", (string? symbols, MarketDataService service, CancellationToken cancellationToken) =>
        {
            var list = (symbols ?? string.Empty).Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
            if (list.Length == 0 || list.Length > MarketDataService.MaxQuoteSymbols || list.Any(symbol => !MarketDataService.IsValidSymbol(symbol)))
            {
                return Task.FromResult<IResult>(Results.BadRequest(new { error = $"Send 1 to {MarketDataService.MaxQuoteSymbols} valid symbols." }));
            }

            return Run(async () => Results.Ok(await service.GetQuotesAsync(list, cancellationToken)));
        });

        trading.MapGet("/candles", (string? symbol, string? interval, int? days, MarketDataService service, CancellationToken cancellationToken) =>
        {
            if (!MarketDataService.IsValidSymbol(symbol)) return Task.FromResult<IResult>(Results.BadRequest(new { error = "The symbol is not valid." }));
            if (!MarketDataService.IsValidInterval(interval)) return Task.FromResult<IResult>(Results.BadRequest(new { error = "The interval must be 5m, 15m, 30m, 60m, 1d, 1wk or 1mo." }));

            return Run(async () => await service.GetCandlesAsync(symbol!, interval!, days ?? 30, cancellationToken) is { Candles.Count: > 0 } candles
                ? Results.Ok(candles)
                : Results.NotFound(new { error = "No prices were found for this symbol." }));
        });

  return app;
 }
 private static async Task<IResult> Run(Func<Task<IResult>> action) {
  try { return await action(); } catch (MarketDataUnavailableException exception) {
   return Results.Json(new { error=exception.Message }, statusCode:502);
  }
 }
}
