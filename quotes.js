const MAX_SYMBOLS = 20;

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=120");
  res.end(JSON.stringify(body));
}

async function fetchJson(url, timeoutMs = 9000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; AIActionDesk/1.0)",
        "Accept": "application/json,text/plain,*/*",
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function finiteNumbers(values) {
  return (values || []).map(Number).filter(Number.isFinite);
}

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

async function quoteFor(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1y&interval=1d`;
  const data = await fetchJson(url);
  const result = data?.chart?.result?.[0];
  if (!result) throw new Error("No chart data");

  const meta = result.meta || {};
  const rawQuote = result.indicators?.quote?.[0] || {};
  const closes = finiteNumbers(rawQuote.close);
  const highs = finiteNumbers(rawQuote.high);
  const volumes = finiteNumbers(rawQuote.volume);
  if (!closes.length) throw new Error("No close data");

  const price = Number(meta.regularMarketPrice || closes[closes.length - 1]);
  const prev = closes.length > 1 ? closes[closes.length - 2] : price;
  const first = closes[0] || price;
  const high52 = Math.max(...highs, price);
  const low52 = Math.min(...closes, price);
  const ma = (days) => average(closes.slice(-days));
  const volume = volumes[volumes.length - 1] || null;
  const avgVol20 = average(volumes.slice(-21, -1));

  return {
    ticker: symbol,
    price,
    changePct: prev ? ((price - prev) / prev) * 100 : 0,
    ytdPct: first ? ((price - first) / first) * 100 : 0,
    high52,
    low52,
    distHighPct: high52 ? ((price - high52) / high52) * 100 : 0,
    distLowPct: low52 ? ((price - low52) / low52) * 100 : 0,
    ma20: ma(20),
    ma50: ma(50),
    ma200: ma(200),
    volume,
    volumeRatio: avgVol20 && volume ? volume / avgVol20 : null,
    marketTime: meta.regularMarketTime ? new Date(meta.regularMarketTime * 1000).toLocaleString("ko-KR") : "",
    ok: true,
  };
}

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") return json(res, 200, { ok: true });
  if (req.method !== "GET") return json(res, 405, { error: "Method not allowed" });

  const symbols = String(req.query.symbols || "")
    .split(",")
    .map((symbol) => symbol.trim())
    .filter(Boolean)
    .slice(0, MAX_SYMBOLS);

  if (!symbols.length) return json(res, 400, { error: "symbols required", results: {} });

  const settled = await Promise.allSettled(symbols.map(quoteFor));
  const results = {};
  settled.forEach((result, index) => {
    const symbol = symbols[index];
    if (result.status === "fulfilled") {
      results[symbol] = result.value;
    } else {
      results[symbol] = { ticker: symbol, ok: false, error: result.reason?.message || "quote failed" };
    }
  });

  return json(res, 200, { at: Date.now(), results });
};
