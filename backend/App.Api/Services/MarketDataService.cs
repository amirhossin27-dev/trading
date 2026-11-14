using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Extensions.Caching.Memory;

namespace Standalone.Api.Services;

public sealed record MarketSearchResult(string Symbol, string Name, string Exchange, string Type);

public sealed record MarketQuote(string Symbol, string Name, string Currency, double Price, double ChangePct, bool? MarketOpen);

/// <summary>One candle; <c>T</c> is the opening time in milliseconds since 1970.</summary>
public sealed record MarketCandle(long T, double O, double H, double L, double C, double V);

public sealed record MarketCandles(string Symbol, string Name, string Currency, IReadOnlyList<MarketCandle> Candles);

/// <summary>Yahoo Finance did not answer in time or with an error; the caller reports it as a bad gateway.</summary>
public sealed class MarketDataUnavailableException(string message, Exception? inner = null) : Exception(message, inner);

/// <summary>
/// Stock, index, currency and commodity prices. Yahoo Finance has no official free API and does not allow browsers to call it,
/// so the platform asks it on the server (with a short cache) and gives the browser plain JSON. Crypto prices are read
/// straight from Binance by the browser.
/// </summary>
public sealed partial class MarketDataService(HttpClient http, IMemoryCache cache)
{
    public const int MaxQuoteSymbols = 20;

    private static readonly TimeSpan QuoteCache = TimeSpan.FromSeconds(15);
    private static readonly TimeSpan CandleCache = TimeSpan.FromSeconds(30);
    private static readonly TimeSpan SearchCache = TimeSpan.FromMinutes(10);

    private static readonly string[] SearchTypes = ["EQUITY", "ETF", "INDEX", "CURRENCY", "FUTURE", "MUTUALFUND"];

    /// <summary>Longest look-back Yahoo serves per candle length (intraday data is only kept for a limited time).</summary>
    private static readonly Dictionary<string, int> MaxDays = new(StringComparer.Ordinal)
    {
        ["5m"] = 59, ["15m"] = 59, ["30m"] = 59, ["60m"] = 729, ["1d"] = 36500, ["1wk"] = 36500, ["1mo"] = 36500,
    };

    public static bool IsValidSymbol(string? symbol) => !string.IsNullOrEmpty(symbol) && SymbolPattern().IsMatch(symbol);

    public static bool IsValidInterval(string? interval) => interval is not null && MaxDays.ContainsKey(interval);

    public async Task<IReadOnlyList<MarketSearchResult>> SearchAsync(string query, CancellationToken cancellationToken)
    {
        var text = query.Trim();
        if (text.Length < 1 || text.Length > 60) return [];

        return await cache.GetOrCreateAsync($"market:search:{text.ToLowerInvariant()}", async entry =>
        {
            entry.AbsoluteExpirationRelativeToNow = SearchCache;
            // Yahoo answers 400 for terms it cannot parse (umlauts, Asian characters): that is "nothing found", not an outage.
            var json = await GetAsync($"https://query2.finance.yahoo.com/v1/finance/search?q={Uri.EscapeDataString(text)}&quotesCount=10&newsCount=0&listsCount=0&lang=en-US&region=US", cancellationToken, badRequestIsMissing: true);
            return json is null ? [] : ParseSearch(json);
        }) ?? [];
    }

    /// <summary>Price and day change of each symbol; symbols Yahoo does not know are left out.</summary>
    public async Task<IReadOnlyList<MarketQuote>> GetQuotesAsync(IEnumerable<string> symbols, CancellationToken cancellationToken)
    {
        var distinct = symbols.Distinct(StringComparer.OrdinalIgnoreCase).Take(MaxQuoteSymbols).ToArray();
        var results = await Task.WhenAll(distinct.Select(symbol => GetQuoteAsync(symbol, cancellationToken)));
        return results.Where(quote => quote is not null).Select(quote => quote!).ToArray();
    }

    public async Task<MarketCandles?> GetCandlesAsync(string symbol, string interval, int days, CancellationToken cancellationToken)
    {
        var lookBack = Math.Clamp(days, 1, MaxDays[interval]);
        // The window is cut to the minute so that repeated requests share one cache entry.
        var now = DateTimeOffset.UtcNow;
        var to = new DateTimeOffset(now.Year, now.Month, now.Day, now.Hour, now.Minute, 0, TimeSpan.Zero);
        var from = to.AddDays(-lookBack);

        return await cache.GetOrCreateAsync($"market:candles:{symbol.ToUpperInvariant()}:{interval}:{lookBack}:{to:yyyyMMddHHmm}", async entry =>
        {
            entry.AbsoluteExpirationRelativeToNow = CandleCache;
            var url = $"https://query1.finance.yahoo.com/v8/finance/chart/{Uri.EscapeDataString(symbol)}?interval={interval}&period1={from.ToUnixTimeSeconds()}&period2={to.AddMinutes(1).ToUnixTimeSeconds()}&includePrePost=false";
            var json = await GetAsync(url, cancellationToken);
            return json is null ? null : ParseChart(json, interval);
        });
    }

    private async Task<MarketQuote?> GetQuoteAsync(string symbol, CancellationToken cancellationToken)
    {
        return await cache.GetOrCreateAsync($"market:quote:{symbol.ToUpperInvariant()}", async entry =>
        {
            entry.AbsoluteExpirationRelativeToNow = QuoteCache;
            var json = await GetAsync($"https://query1.finance.yahoo.com/v8/finance/chart/{Uri.EscapeDataString(symbol)}?interval=1d&range=5d", cancellationToken);
            return json is null ? null : ParseQuote(json, DateTimeOffset.UtcNow);
        });
    }

    /// <summary>The response body, <c>null</c> for an unknown symbol; throws when Yahoo cannot be reached.</summary>
    private async Task<string?> GetAsync(string url, CancellationToken cancellationToken, bool badRequestIsMissing = false)
    {
        try
        {
            using var response = await http.GetAsync(url, cancellationToken);
            if (response.StatusCode == System.Net.HttpStatusCode.NotFound) return null;
            if (badRequestIsMissing && response.StatusCode == System.Net.HttpStatusCode.BadRequest) return null;
            if (!response.IsSuccessStatusCode) throw new MarketDataUnavailableException($"Yahoo Finance answered with HTTP {(int)response.StatusCode}.");
            return await response.Content.ReadAsStringAsync(cancellationToken);
        }
        catch (HttpRequestException exception)
        {
            System.Diagnostics.Trace.TraceWarning("Data source request failed: {0}", exception.GetType().Name);
            throw new MarketDataUnavailableException("Yahoo Finance could not be reached.", exception);
        }
        catch (TaskCanceledException exception) when (!cancellationToken.IsCancellationRequested)
        {
            System.Diagnostics.Trace.TraceWarning("Data source request failed: {0}", exception.GetType().Name);
            throw new MarketDataUnavailableException("Yahoo Finance did not answer in time.", exception);
        }
    }

    // ---------- Parsing (static, so that it can be tested without a network) ----------

    public static IReadOnlyList<MarketSearchResult> ParseSearch(string json)
    {
        using var document = JsonDocument.Parse(json);
        if (!document.RootElement.TryGetProperty("quotes", out var quotes) || quotes.ValueKind != JsonValueKind.Array) return [];

        var results = new List<MarketSearchResult>();
        foreach (var item in quotes.EnumerateArray())
        {
            var symbol = Text(item, "symbol");
            var type = Text(item, "quoteType")?.ToUpperInvariant();
            if (symbol is null || type is null || !SearchTypes.Contains(type) || !IsValidSymbol(symbol)) continue;
            var name = Clean(Text(item, "longname") ?? Text(item, "shortname") ?? symbol);
            results.Add(new MarketSearchResult(symbol, name, Text(item, "exchDisp") ?? Text(item, "exchange") ?? string.Empty, type));
        }

        return results;
    }

    public static MarketCandles? ParseChart(string json, string? interval = null)
    {
        using var document = JsonDocument.Parse(json);
        if (!TryGetResult(document.RootElement, out var result)) return null;

        var meta = result.GetProperty("meta");
        var symbol = Text(meta, "symbol") ?? string.Empty;
        var candles = new List<MarketCandle>();
        if (result.TryGetProperty("timestamp", out var timestamps) && timestamps.ValueKind == JsonValueKind.Array
            && result.TryGetProperty("indicators", out var indicators)
            && indicators.TryGetProperty("quote", out var quoteList) && quoteList.GetArrayLength() > 0)
        {
            var quote = quoteList[0];
            var open = Numbers(quote, "open");
            var high = Numbers(quote, "high");
            var low = Numbers(quote, "low");
            var close = Numbers(quote, "close");
            var volume = Numbers(quote, "volume");
            var index = 0;
            foreach (var stamp in timestamps.EnumerateArray())
            {
                if (index < close.Length && stamp.TryGetInt64(out var seconds) && open[index] is { } o && high[index] is { } h && low[index] is { } l && close[index] is { } c)
                {
                    candles.Add(new MarketCandle(seconds * 1000, o, h, l, c, index < volume.Length ? volume[index] ?? 0 : 0));
                }

                index++;
            }
        }

        MergeLiveRow(candles, interval);
        return new MarketCandles(symbol, Clean(Text(meta, "longName") ?? Text(meta, "shortName") ?? symbol), Text(meta, "currency") ?? "USD", candles);
    }

    /// <summary>
    /// For weekly and monthly candles Yahoo adds one more row with the time of the last trade, which holds only today's prices
    /// next to the correct row of the running week or month. It is folded into that row.
    /// </summary>
    private static void MergeLiveRow(List<MarketCandle> candles, string? interval)
    {
        var minimumGap = interval switch { "1wk" => TimeSpan.FromDays(5), "1mo" => TimeSpan.FromDays(25), _ => TimeSpan.Zero };
        if (minimumGap == TimeSpan.Zero || candles.Count < 2) return;

        var last = candles[^1];
        var previous = candles[^2];
        if (last.T - previous.T >= minimumGap.TotalMilliseconds) return;

        candles[^2] = previous with { H = Math.Max(previous.H, last.H), L = Math.Min(previous.L, last.L), C = last.C, V = previous.V + last.V };
        candles.RemoveAt(candles.Count - 1);
    }

    public static MarketQuote? ParseQuote(string json, DateTimeOffset now)
    {
        using var document = JsonDocument.Parse(json);
        if (!TryGetResult(document.RootElement, out var result)) return null;

        var meta = result.GetProperty("meta");
        var price = Number(meta, "regularMarketPrice");
        if (price is null) return null;

        var change = Number(meta, "regularMarketChangePercent");
        if (change is null)
        {
            // Without Yahoo's own figure: compare with the close of the day before.
            var closes = result.TryGetProperty("indicators", out var indicators) && indicators.TryGetProperty("quote", out var quotes) && quotes.GetArrayLength() > 0
                ? Numbers(quotes[0], "close").Where(value => value is not null).Select(value => value!.Value).ToArray()
                : [];
            var previous = closes.Length >= 2 ? closes[^2] : closes.Length == 1 ? closes[0] : (double?)null;
            change = previous is > 0 ? (price.Value / previous.Value - 1) * 100 : 0;
        }

        bool? open = null;
        if (meta.TryGetProperty("currentTradingPeriod", out var period) && period.TryGetProperty("regular", out var regular)
            && regular.TryGetProperty("start", out var start) && regular.TryGetProperty("end", out var end)
            && start.TryGetInt64(out var startSeconds) && end.TryGetInt64(out var endSeconds))
        {
            var seconds = now.ToUnixTimeSeconds();
            open = seconds >= startSeconds && seconds < endSeconds;
        }

        var symbol = Text(meta, "symbol") ?? string.Empty;
        return new MarketQuote(symbol, Clean(Text(meta, "longName") ?? Text(meta, "shortName") ?? symbol), Text(meta, "currency") ?? "USD", price.Value, Math.Round(change.Value, 3), open);
    }

    private static bool TryGetResult(JsonElement root, out JsonElement result)
    {
        result = default;
        return root.TryGetProperty("chart", out var chart)
            && chart.TryGetProperty("result", out var results)
            && results.ValueKind == JsonValueKind.Array
            && results.GetArrayLength() > 0
            && (result = results[0]).ValueKind == JsonValueKind.Object
            && result.TryGetProperty("meta", out _);
    }

    private static string? Text(JsonElement element, string name) =>
        element.ValueKind == JsonValueKind.Object && element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;

    private static double? Number(JsonElement element, string name) =>
        element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.Number && value.TryGetDouble(out var number) && double.IsFinite(number) ? number : null;

    private static double?[] Numbers(JsonElement element, string name)
    {
        if (!element.TryGetProperty(name, out var list) || list.ValueKind != JsonValueKind.Array) return [];
        return list.EnumerateArray()
            .Select(value => value.ValueKind == JsonValueKind.Number && value.TryGetDouble(out var number) && double.IsFinite(number) ? (double?)number : null)
            .ToArray();
    }

    /// <summary>Yahoo pads short names with spaces ("SAP SE      I").</summary>
    private static string Clean(string value) => WhitespacePattern().Replace(value, " ").Trim();

    [GeneratedRegex(@"^[A-Za-z0-9.^=\-_]{1,24}$", RegexOptions.CultureInvariant)]
    private static partial Regex SymbolPattern();

    [GeneratedRegex(@"\s+", RegexOptions.CultureInvariant)]
    private static partial Regex WhitespacePattern();
}
