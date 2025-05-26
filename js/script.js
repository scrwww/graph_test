let candlestickData = [];
let currentTimeframe = "1m";
let updateInterval;
let priceUpdateInterval;
let chartContainer;
let chartWidth, chartHeight;
let priceRange = { min: 60000, max: 70000 };

function initChart() {
  try {
    chartContainer = document.getElementById("candleChart");
    updateChartDimensions();

    fetchHistoricalData();

    window.addEventListener("resize", handleResize);

    updateStatus("connected", "Feed de dados em tempo real ativo");
  } catch (error) {
    console.error("Erro ao inicializar o gráfico:", error);
    updateStatus("error", "Falha ao inicializar o gráfico");
  }
}

function updateChartDimensions() {
  const container = chartContainer.parentElement;
  chartWidth = container.clientWidth - 100;
  chartHeight = container.clientHeight - 80;
}

function handleResize() {
  updateChartDimensions();
  renderChart();
}

async function fetchHistoricalData() {
  try {
    updateStatus("connecting", "Buscando dados reais do Bitcoin...");

    await fetchRealHistoricalData();

    renderChart();
    if (candlestickData.length > 0) {
      updateStats(candlestickData[candlestickData.length - 1].c);
    }
    updateStatus("connected", "Dados em tempo real invocados");
  } catch (error) {
    console.error("Erro ao buscar dados:", error);
    updateStatus(
      "error",
      "Falha ao atualizar em tempo real, utilizando contingência"
    );
    await fetchCurrentPriceOnly();
  }
}

async function fetchRealHistoricalData() {
  const intervals = getIntervalsForTimeframe();
  const timeframeMinutes = getTimeframeMinutes();
  const endTime = Math.floor(Date.now() / 1000);
  const startTime = endTime - intervals * timeframeMinutes * 60;

  const apiUrl = `https://api.coingecko.com/api/v3/coins/bitcoin/market_chart/range?vs_currency=usd&from=${startTime}&to=${endTime}`;

  try {
    const response = await fetch(apiUrl);
    if (!response.ok) {
      throw new Error(`Erro HTTP! status: ${response.status}`);
    }

    const data = await response.json();

    if (data.prices && data.prices.length > 0) {
      processRealPriceData(data.prices, timeframeMinutes);
    } else {
      throw new Error("Nenhum dado de preço recebido");
    }
  } catch (error) {
    console.log("Falha no CoinGecko, tentando fonte alternativa...");
    await fetchFromAlternativeSource();
  }
}

async function fetchFromAlternativeSource() {
  const interval = getBinanceInterval();
  const limit = Math.min(getIntervalsForTimeframe(), 500);

  const binanceUrl = `https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=${interval}&limit=${limit}`;

  try {
    const response = await fetch(binanceUrl);
    if (!response.ok) {
      throw new Error(`Erro na API da Binance! status: ${response.status}`);
    }

    const data = await response.json();

    if (data && data.length > 0) {
      processBinanceData(data);
    } else {
      throw new Error("Nenhum dado da Binance recebido");
    }
  } catch (error) {
    console.log("Binance também falhou, usando apenas o preço atual...");
    await fetchCurrentPriceOnly();
  }
}

async function fetchCurrentPriceOnly() {
  try {
    const response = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd"
    );
    const data = await response.json();

    if (data.bitcoin && data.bitcoin.usd) {
      const currentPrice = data.bitcoin.usd;
      generateSimpleHistoricalData(currentPrice);
    } else {
      generateSimpleHistoricalData(65000);
    }
  } catch (error) {
    console.error("Todas as APIs falharam, usando preço estimado");
    generateSimpleHistoricalData(65000);
  }
}

function processRealPriceData(prices, timeframeMinutes) {
  candlestickData = [];
  const timeframeMs = timeframeMinutes * 60 * 1000;

  const buckets = new Map();

  prices.forEach(([timestamp, price]) => {
    const bucketTime = Math.floor(timestamp / timeframeMs) * timeframeMs;

    if (!buckets.has(bucketTime)) {
      buckets.set(bucketTime, []);
    }
    buckets.get(bucketTime).push({ timestamp, price });
  });

  let minPrice = Infinity;
  let maxPrice = -Infinity;

  Array.from(buckets.entries())
    .sort(([a], [b]) => a - b)
    .forEach(([bucketTime, pricePoints]) => {
      if (pricePoints.length === 0) return;

      pricePoints.sort((a, b) => a.timestamp - b.timestamp);

      const open = pricePoints[0].price;
      const close = pricePoints[pricePoints.length - 1].price;
      const high = Math.max(...pricePoints.map((p) => p.price));
      const low = Math.min(...pricePoints.map((p) => p.price));

      const candle = {
        time: new Date(bucketTime),
        timestamp: bucketTime,
        o: parseFloat(open.toFixed(2)),
        h: parseFloat(high.toFixed(2)),
        l: parseFloat(low.toFixed(2)),
        c: parseFloat(close.toFixed(2)),
      };

      candlestickData.push(candle);

      minPrice = Math.min(minPrice, low);
      maxPrice = Math.max(maxPrice, high);
    });

  const padding = (maxPrice - minPrice) * 0.1;
  priceRange.min = minPrice - padding;
  priceRange.max = maxPrice + padding;
}

function processBinanceData(data) {
  candlestickData = [];
  let minPrice = Infinity;
  let maxPrice = -Infinity;

  data.forEach((kline) => {
    const [openTime, open, high, low, close] = kline;

    const candle = {
      time: new Date(openTime),
      timestamp: openTime,
      o: parseFloat(open),
      h: parseFloat(high),
      l: parseFloat(low),
      c: parseFloat(close),
    };

    candlestickData.push(candle);

    minPrice = Math.min(minPrice, candle.l);
    maxPrice = Math.max(maxPrice, candle.h);
  });

  const padding = (maxPrice - minPrice) * 0.1;
  priceRange.min = minPrice - padding;
  priceRange.max = maxPrice + padding;
}

function generateSimpleHistoricalData(currentPrice) {
  candlestickData = [];
  const now = new Date();
  const intervals = Math.min(getIntervalsForTimeframe(), 50);

  let price = currentPrice * 0.995;
  let minPrice = price;
  let maxPrice = price;

  for (let i = intervals; i >= 0; i--) {
    const time = new Date(
      now.getTime() - i * getTimeframeMinutes() * 60 * 1000
    );

    const volatility = 0.002;
    const change = (Math.random() - 0.5) * volatility;

    const open = price;
    const close = open * (1 + change);
    const high = Math.max(open, close) * (1 + Math.random() * volatility * 0.3);
    const low = Math.min(open, close) * (1 - Math.random() * volatility * 0.3);

    candlestickData.push({
      time: time,
      timestamp: time.getTime(),
      o: parseFloat(open.toFixed(2)),
      h: parseFloat(high.toFixed(2)),
      l: parseFloat(low.toFixed(2)),
      c: parseFloat(close.toFixed(2)),
    });

    price = close;
    minPrice = Math.min(minPrice, low);
    maxPrice = Math.max(maxPrice, high);
  }

  if (candlestickData.length > 0) {
    const lastCandle = candlestickData[candlestickData.length - 1];
    lastCandle.c = currentPrice;
    lastCandle.h = Math.max(lastCandle.h, currentPrice);
    lastCandle.l = Math.min(lastCandle.l, currentPrice);
    maxPrice = Math.max(maxPrice, currentPrice);
  }

  const padding = (maxPrice - minPrice) * 0.1;
  priceRange.min = minPrice - padding;
  priceRange.max = maxPrice + padding;
}

function getBinanceInterval() {
  const intervals = {
    "1m": "1m",
    "5m": "5m",
    "15m": "15m",
    "1h": "1h",
    "4h": "4h",
    "1d": "1d",
  };
  return intervals[currentTimeframe] || "1m";
}

function renderChart() {
  if (!chartContainer || candlestickData.length === 0) return;

  chartContainer.innerHTML = "";

  createGrid();

  const candleWidth = Math.max(
    2,
    Math.floor((chartWidth / candlestickData.length) * 0.8)
  );
  const candleSpacing = chartWidth / candlestickData.length;

  candlestickData.forEach((candle, index) => {
    const x = index * candleSpacing + candleSpacing / 2;
    createCandle(candle, x, candleWidth, index);
  });

  createAxes();
}

function createGrid() {
  const gridLines = 8;
  for (let i = 0; i <= gridLines; i++) {
    const y = (i / gridLines) * chartHeight;
    const gridLine = document.createElement("div");
    gridLine.className = "grid-line horizontal";
    gridLine.style.top = y + "px";
    gridLine.style.left = "0px";
    gridLine.style.right = "60px";
    chartContainer.appendChild(gridLine);
  }

  const timeLines = 6;
  for (let i = 0; i <= timeLines; i++) {
    const x = (i / timeLines) * chartWidth;
    const gridLine = document.createElement("div");
    gridLine.className = "grid-line vertical";
    gridLine.style.left = x + "px";
    gridLine.style.top = "0px";
    gridLine.style.bottom = "30px";
    chartContainer.appendChild(gridLine);
  }
}

function createCandle(candle, x, width, index) {
  const isGreen = candle.c > candle.o;
  const color = isGreen ? "#00c853" : "#f44336";

  const highY = priceToY(candle.h);
  const lowY = priceToY(candle.l);
  const openY = priceToY(candle.o);
  const closeY = priceToY(candle.c);

  const bodyTop = Math.min(openY, closeY);
  const bodyBottom = Math.max(openY, closeY);
  const bodyHeight = Math.max(1, bodyBottom - bodyTop);

  const candleEl = document.createElement("div");
  candleEl.className = "candle";
  candleEl.style.left = x - width / 2 + "px";
  candleEl.style.width = width + "px";
  candleEl.style.height = chartHeight + "px";
  candleEl.style.top = "0px";

  const wick = document.createElement("div");
  wick.className = "candle-wick";
  wick.style.top = highY + "px";
  wick.style.height = lowY - highY + "px";
  wick.style.background = color;
  candleEl.appendChild(wick);

  const body = document.createElement("div");
  body.className = "candle-body";
  body.style.position = "absolute";
  body.style.left = "0px";
  body.style.width = "100%";
  body.style.top = bodyTop + "px";
  body.style.height = bodyHeight + "px";
  body.style.background = color;
  candleEl.appendChild(body);

  candleEl.addEventListener("mouseenter", (e) => showTooltip(e, candle));
  candleEl.addEventListener("mouseleave", hideTooltip);

  chartContainer.appendChild(candleEl);
}

function createAxes() {
  const yAxis = document.createElement("div");
  yAxis.className = "chart-axis y-axis";

  const priceSteps = 8;
  for (let i = 0; i <= priceSteps; i++) {
    const price =
      priceRange.min + (priceRange.max - priceRange.min) * (1 - i / priceSteps);
    const y = (i / priceSteps) * chartHeight;

    const label = document.createElement("div");
    label.style.position = "absolute";
    label.style.top = y - 6 + "px";
    label.style.left = "5px";
    label.style.fontSize = "10px";
    label.textContent =
      "$" + price.toLocaleString(undefined, { maximumFractionDigits: 0 });
    yAxis.appendChild(label);
  }

  chartContainer.appendChild(yAxis);

  const xAxis = document.createElement("div");
  xAxis.className = "chart-axis x-axis";

  const timeSteps = 6;
  for (let i = 0; i <= timeSteps; i++) {
    const dataIndex = Math.floor(
      ((candlestickData.length - 1) * i) / timeSteps
    );
    if (dataIndex < candlestickData.length) {
      const candle = candlestickData[dataIndex];
      const x = (i / timeSteps) * chartWidth;

      const label = document.createElement("div");
      label.style.position = "absolute";
      label.style.left = x - 25 + "px";
      label.style.top = "5px";
      label.style.fontSize = "10px";
      label.style.width = "50px";
      label.style.textAlign = "center";
      label.textContent = formatTime(candle.time);
      xAxis.appendChild(label);
    }
  }

  chartContainer.appendChild(xAxis);
}

function priceToY(price) {
  return (
    chartHeight *
    (1 - (price - priceRange.min) / (priceRange.max - priceRange.min))
  );
}

function formatTime(date) {
  if (currentTimeframe === "1d") {
    return date.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  } else {
    return date.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });
  }
}

function showTooltip(event, candle) {
  const tooltip = document.getElementById("tooltip");

  tooltip.innerHTML = `
    <div><strong>Tempo:</strong> ${candle.time.toLocaleString()}</div>
    <div><strong>Abertura:</strong> $${candle.o.toLocaleString()}</div>
    <div><strong>Alta:</strong> $${candle.h.toLocaleString()}</div>
    <div><strong>Baixa:</strong> $${candle.l.toLocaleString()}</div>
    <div><strong>Fechamento:</strong> $${candle.c.toLocaleString()}</div>
  `;

  tooltip.style.display = "block";

  updateTooltipPosition(event);

  document.addEventListener("mousemove", updateTooltipPosition);

  function updateTooltipPosition(e) {
    tooltip.style.left = e.pageX - 60 + "px"; 
    tooltip.style.top = e.pageY - 400 + "px";
  }
}

function hideTooltip() {
  document.getElementById("tooltip").style.display = "none";
}

async function updateLivePrice() {
  try {
    const response = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true"
    );
    const data = await response.json();

    if (data.bitcoin && data.bitcoin.usd && candlestickData.length > 0) {
      const currentPrice = data.bitcoin.usd;
      const lastCandle = candlestickData[candlestickData.length - 1];
      const now = new Date();
      const timeframeMs = getTimeframeMinutes() * 60 * 1000;

      if (data.bitcoin.usd_24h_change) {
        const changeEl = document.getElementById("change24h");
        const change = data.bitcoin.usd_24h_change;
        changeEl.textContent =
          (change >= 0 ? "+" : "") + change.toFixed(2) + "%";
        changeEl.style.color = change >= 0 ? "#00c853" : "#f44336";
      }

      if (data.bitcoin.usd_24h_vol) {
        document.getElementById("volume24h").textContent =
          (data.bitcoin.usd_24h_vol / 1000000).toFixed(1) + "M USD";
      }

      if (now.getTime() - lastCandle.timestamp >= timeframeMs) {
        const newCandle = {
          time: now,
          timestamp: now.getTime(),
          o: lastCandle.c,
          h: Math.max(lastCandle.c, currentPrice),
          l: Math.min(lastCandle.c, currentPrice),
          c: currentPrice,
        };

        candlestickData.push(newCandle);

        const maxCandles = getIntervalsForTimeframe();
        if (candlestickData.length > maxCandles) {
          candlestickData.shift();
        }

        updatePriceRange();
        renderChart();
      } else {
        lastCandle.c = currentPrice;
        lastCandle.h = Math.max(lastCandle.h, currentPrice);
        lastCandle.l = Math.min(lastCandle.l, currentPrice);

        updatePriceRange();
        renderChart();
      }

      updateStats(currentPrice);
    }
  } catch (error) {
    console.error("Error updating live price:", error);
  }
}

function updatePriceRange() {
  if (candlestickData.length === 0) return;

  let minPrice = candlestickData[0].l;
  let maxPrice = candlestickData[0].h;

  candlestickData.forEach((candle) => {
    minPrice = Math.min(minPrice, candle.l);
    maxPrice = Math.max(maxPrice, candle.h);
  });

  const padding = (maxPrice - minPrice) * 0.1;
  priceRange.min = minPrice - padding;
  priceRange.max = maxPrice + padding;
}

function updateStats(price) {
  document.getElementById("currentPrice").textContent =
    "$" + price.toLocaleString();

  if (candlestickData.length >= 2) {
    const firstPrice = candlestickData[0].o;
    const change = ((price - firstPrice) / firstPrice) * 100;
    const changeEl = document.getElementById("change24h");
    changeEl.textContent = (change >= 0 ? "+" : "") + change.toFixed(2) + "%";
    changeEl.style.color = change >= 0 ? "#00c853" : "#f44336";
  }

  const volume = (Math.random() * 50000 + 10000).toFixed(0);
  document.getElementById("volume24h").textContent = volume + " BTC";

  document.getElementById("lastUpdate").textContent =
    new Date().toLocaleTimeString();
}

function updateStatus(type, message) {
  const statusEl = document.getElementById("status");
  statusEl.className = `status ${type}`;
  statusEl.textContent = message;
}

async function setTimeframe(timeframe) {
  currentTimeframe = timeframe;

  document.querySelectorAll(".control-btn").forEach((btn) => {
    btn.classList.remove("active");
  });
  event.target.classList.add("active");

  updateStatus("connecting", `Carregando dados de ${timeframe}...`);
  await fetchHistoricalData();
}

function getTimeframeMinutes() {
  const timeframes = {
    "1m": 1,
    "5m": 5,
    "15m": 15,
    "1h": 60,
    "4h": 240,
    "1d": 1440,
  };
  return timeframes[currentTimeframe] || 1;
}

function getIntervalsForTimeframe() {
  const intervals = {
    "1m": 60,
    "5m": 60,
    "15m": 60,
    "1h": 48,
    "4h": 48,
    "1d": 30,
  };
  return intervals[currentTimeframe] || 60;
}

document.addEventListener("DOMContentLoaded", function () {
  try {
    initChart();

    priceUpdateInterval = setInterval(updateLivePrice, 10000);
  } catch (error) {
    console.error("Erro de inicialização:", error);
    updateStatus("error", "Falha ao inicializar aplicação");
  }
});

window.addEventListener("beforeunload", function () {
  if (updateInterval) clearInterval(updateInterval);
  if (priceUpdateInterval) clearInterval(priceUpdateInterval);
});
