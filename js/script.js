/**
 * Bitcoin Candlestick Chart - Versão Melhorada
 * Melhorias aplicadas: arquitetura modular, tratamento de erros robusto,
 * performance otimizada, código mais limpo e manutenível
 */

class BitcoinCandlestickChart {
  constructor(containerId) {
    this.containerId = containerId;
    this.candlestickData = [];
    this.currentTimeframe = "1m";
    this.chartContainer = null;
    this.chartWidth = 0;
    this.chartHeight = 0;
    this.priceRange = { min: 60000, max: 700000 };
    
    // Intervalos e timeouts
    this.updateInterval = null;
    this.priceUpdateInterval = null;
    this.retryTimeout = null;
    
    // Configurações
    this.config = {
      maxRetries: 3,
      retryDelay: 2000,
      updateFrequency: 10000,
      colors: {
        bullish: "#00c853",
        bearish: "#f44336",
        grid: "#333",
        text: "#fff"
      },
      timeframes: {
        "1m": { minutes: 1, intervals: 60, binance: "1m" },
        "5m": { minutes: 5, intervals: 60, binance: "5m" },
        "15m": { minutes: 15, intervals: 60, binance: "15m" },
        "1h": { minutes: 60, intervals: 48, binance: "1h" },
        "4h": { minutes: 240, intervals: 48, binance: "4h" },
        "1d": { minutes: 1440, intervals: 30, binance: "1d" }
      }
    };

    this.apiService = new ApiService();
    this.chartRenderer = new ChartRenderer(this);
    this.uiController = new UIController(this);
    
    this.init();
  }

  async init() {
    try {
      this.setupContainer();
      this.bindEvents();
      await this.loadInitialData();
      this.startLiveUpdates();
      this.uiController.updateStatus("connected", "Feed de dados em tempo real ativo");
    } catch (error) {
      console.error("Erro ao inicializar o gráfico:", error);
      this.uiController.updateStatus("error", "Falha ao inicializar o gráfico");
    }
  }

  setupContainer() {
    this.chartContainer = document.getElementById(this.containerId);
    if (!this.chartContainer) {
      throw new Error(`Container ${this.containerId} não encontrado`);
    }
    this.updateChartDimensions();
  }

  updateChartDimensions() {
    const container = this.chartContainer.parentElement;
    this.chartWidth = Math.max(300, container.clientWidth - 100);
    this.chartHeight = Math.max(200, container.clientHeight - 80);
  }

  bindEvents() {
    window.addEventListener("resize", this.debounce(() => {
      this.updateChartDimensions();
      this.chartRenderer.render();
    }, 250));

    window.addEventListener("beforeunload", () => this.cleanup());
  }

  async loadInitialData() {
    try {
      this.uiController.updateStatus("connecting", "Buscando dados reais do Bitcoin...");
      
      const data = await this.apiService.fetchHistoricalData(
        this.currentTimeframe,
        this.config.timeframes[this.currentTimeframe]
      );
      
      this.processCandlestickData(data);
      this.chartRenderer.render();
      this.updateStatistics();
      
      this.uiController.updateStatus("connected", "Dados em tempo real carregados");
    } catch (error) {
      console.error("Erro ao carregar dados iniciais:", error);
      this.uiController.updateStatus("error", "Falha ao carregar dados - usando modo offline");
      this.generateFallbackData();
    }
  }

  processCandlestickData(data) {
    if (!data || data.length === 0) {
      throw new Error("Dados inválidos recebidos");
    }

    this.candlestickData = data.map(item => ({
      time: new Date(item.timestamp),
      timestamp: item.timestamp,
      o: this.roundPrice(item.open),
      h: this.roundPrice(item.high),
      l: this.roundPrice(item.low),
      c: this.roundPrice(item.close)
    }));

    this.updatePriceRange();
  }

  updatePriceRange() {
    if (this.candlestickData.length === 0) return;

    const prices = this.candlestickData.flatMap(candle => [candle.h, candle.l]);
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const padding = (maxPrice - minPrice) * 0.1;

    this.priceRange = {
      min: minPrice - padding,
      max: maxPrice + padding
    };
  }

  async setTimeframe(timeframe) {
    if (!this.config.timeframes[timeframe]) {
      console.warn(`Timeframe inválido: ${timeframe}`);
      return;
    }

    this.currentTimeframe = timeframe;
    this.uiController.updateTimeframeButtons(timeframe);
    
    try {
      this.uiController.updateStatus("connecting", `Carregando dados de ${timeframe}...`);
      await this.loadInitialData();
    } catch (error) {
      console.error("Erro ao alterar timeframe:", error);
      this.uiController.updateStatus("error", "Falha ao alterar período");
    }
  }

  startLiveUpdates() {
    this.stopLiveUpdates();
    this.priceUpdateInterval = setInterval(() => {
      this.updateLivePrice();
    }, this.config.updateFrequency);
  }

  stopLiveUpdates() {
    if (this.priceUpdateInterval) {
      clearInterval(this.priceUpdateInterval);
      this.priceUpdateInterval = null;
    }
  }

  async updateLivePrice() {
    try {
      const priceData = await this.apiService.fetchCurrentPrice();
      this.updateLastCandle(priceData);
      this.updateStatistics(priceData);
      this.chartRenderer.render();
    } catch (error) {
      console.error("Erro ao atualizar preço:", error);
    }
  }

  updateLastCandle(priceData) {
    if (this.candlestickData.length === 0) return;

    const lastCandle = this.candlestickData[this.candlestickData.length - 1];
    const now = new Date();
    const timeframeMs = this.config.timeframes[this.currentTimeframe].minutes * 60 * 1000;

    if (now.getTime() - lastCandle.timestamp >= timeframeMs) {
      // Criar nova vela
      const newCandle = {
        time: now,
        timestamp: now.getTime(),
        o: lastCandle.c,
        h: Math.max(lastCandle.c, priceData.price),
        l: Math.min(lastCandle.c, priceData.price),
        c: priceData.price
      };

      this.candlestickData.push(newCandle);
      
      // Manter apenas o número necessário de velas
      const maxCandles = this.config.timeframes[this.currentTimeframe].intervals;
      if (this.candlestickData.length > maxCandles) {
        this.candlestickData.shift();
      }
    } else {
      // Atualizar vela atual
      lastCandle.c = priceData.price;
      lastCandle.h = Math.max(lastCandle.h, priceData.price);
      lastCandle.l = Math.min(lastCandle.l, priceData.price);
    }

    this.updatePriceRange();
  }

  updateStatistics(priceData) {
    if (!priceData && this.candlestickData.length > 0) {
      const lastCandle = this.candlestickData[this.candlestickData.length - 1];
      priceData = { price: lastCandle.c };
    }

    if (priceData) {
      this.uiController.updatePriceDisplay(priceData, this.candlestickData);
    }
  }

  generateFallbackData(basePrice = 65000) {
    const intervals = this.config.timeframes[this.currentTimeframe].intervals;
    const timeframeMs = this.config.timeframes[this.currentTimeframe].minutes * 60 * 1000;
    const now = Date.now();
    
    this.candlestickData = [];
    let price = basePrice * 0.995;

    for (let i = intervals; i >= 0; i--) {
      const timestamp = now - (i * timeframeMs);
      const volatility = 0.002;
      const change = (Math.random() - 0.5) * volatility;

      const open = price;
      const close = open * (1 + change);
      const high = Math.max(open, close) * (1 + Math.random() * volatility * 0.3);
      const low = Math.min(open, close) * (1 - Math.random() * volatility * 0.3);

      this.candlestickData.push({
        time: new Date(timestamp),
        timestamp,
        o: this.roundPrice(open),
        h: this.roundPrice(high),
        l: this.roundPrice(low),
        c: this.roundPrice(close)
      });

      price = close;
    }

    this.updatePriceRange();
    this.chartRenderer.render();
  }

  roundPrice(price) {
    return parseFloat(price.toFixed(2));
  }

  debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }

  cleanup() {
    this.stopLiveUpdates();
    if (this.retryTimeout) {
      clearTimeout(this.retryTimeout);
    }
  }
}

/**
 * Serviço para gerenciar chamadas às APIs
 */
class ApiService {
  constructor() {
    this.baseUrls = {
      coingecko: "https://api.coingecko.com/api/v3",
      binance: "https://api.binance.com/api/v3"
    };
    this.requestCache = new Map();
    this.cacheTimeout = 30000; // 30 segundos
  }

  async fetchHistoricalData(timeframe, config) {
    const cacheKey = `historical-${timeframe}`;
    
    if (this.isCacheValid(cacheKey)) {
      return this.requestCache.get(cacheKey).data;
    }

    try {
      const data = await this.fetchFromCoingecko(config);
      this.setCache(cacheKey, data);
      return data;
    } catch (error) {
      console.log("CoinGecko falhou, tentando Binance...");
      try {
        const data = await this.fetchFromBinance(config);
        this.setCache(cacheKey, data);
        return data;
      } catch (binanceError) {
        console.error("Todas as APIs falharam:", binanceError);
        throw new Error("Falha ao obter dados históricos");
      }
    }
  }

  async fetchFromCoingecko(config) {
    const endTime = Math.floor(Date.now() / 1000);
    const startTime = endTime - (config.intervals * config.minutes * 60);
    
    const url = `${this.baseUrls.coingecko}/coins/bitcoin/market_chart/range?vs_currency=usd&from=${startTime}&to=${endTime}`;
    
    const response = await this.makeRequest(url);
    
    if (!response.prices || response.prices.length === 0) {
      throw new Error("Dados de preço inválidos do CoinGecko");
    }

    return this.processCoingeckoData(response.prices, config.minutes);
  }

  async fetchFromBinance(config) {
    const url = `${this.baseUrls.binance}/klines?symbol=BTCUSDT&interval=${config.binance}&limit=${Math.min(config.intervals, 500)}`;
    
    const response = await this.makeRequest(url);
    
    if (!Array.isArray(response) || response.length === 0) {
      throw new Error("Dados inválidos da Binance");
    }

    return this.processBinanceData(response);
  }

  async fetchCurrentPrice() {
    const cacheKey = "current-price";
    
    if (this.isCacheValid(cacheKey)) {
      return this.requestCache.get(cacheKey).data;
    }

    const url = `${this.baseUrls.coingecko}/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true`;
    
    try {
      const response = await this.makeRequest(url);
      
      if (!response.bitcoin || !response.bitcoin.usd) {
        throw new Error("Dados de preço atual inválidos");
      }

      const priceData = {
        price: response.bitcoin.usd,
        change24h: response.bitcoin.usd_24h_change || 0,
        volume24h: response.bitcoin.usd_24h_vol || 0
      };

      this.setCache(cacheKey, priceData);
      return priceData;
    } catch (error) {
      console.error("Erro ao buscar preço atual:", error);
      throw error;
    }
  }

  async makeRequest(url, options = {}) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  processCoingeckoData(prices, timeframeMinutes) {
    const timeframeMs = timeframeMinutes * 60 * 1000;
    const buckets = new Map();

    prices.forEach(([timestamp, price]) => {
      const bucketTime = Math.floor(timestamp / timeframeMs) * timeframeMs;
      
      if (!buckets.has(bucketTime)) {
        buckets.set(bucketTime, []);
      }
      buckets.get(bucketTime).push({ timestamp, price });
    });

    return Array.from(buckets.entries())
      .sort(([a], [b]) => a - b)
      .map(([bucketTime, pricePoints]) => {
        pricePoints.sort((a, b) => a.timestamp - b.timestamp);
        
        return {
          timestamp: bucketTime,
          open: pricePoints[0].price,
          close: pricePoints[pricePoints.length - 1].price,
          high: Math.max(...pricePoints.map(p => p.price)),
          low: Math.min(...pricePoints.map(p => p.price))
        };
      });
  }

  processBinanceData(klines) {
    return klines.map(([openTime, open, high, low, close]) => ({
      timestamp: openTime,
      open: parseFloat(open),
      high: parseFloat(high),
      low: parseFloat(low),
      close: parseFloat(close)
    }));
  }

  isCacheValid(key) {
    const cached = this.requestCache.get(key);
    return cached && (Date.now() - cached.timestamp < this.cacheTimeout);
  }

  setCache(key, data) {
    this.requestCache.set(key, {
      data,
      timestamp: Date.now()
    });
  }
}

/**
 * Controlador da interface do usuário
 */
class UIController {
  constructor(chart) {
    this.chart = chart;
  }

  updateStatus(type, message) {
    const statusEl = document.getElementById("status");
    if (statusEl) {
      statusEl.className = `status ${type}`;
      statusEl.textContent = message;
    }
  }

  updateTimeframeButtons(activeTimeframe) {
    document.querySelectorAll(".control-btn").forEach(btn => {
      btn.classList.remove("active");
      if (btn.dataset.timeframe === activeTimeframe) {
        btn.classList.add("active");
      }
    });
  }

  updatePriceDisplay(priceData, candlestickData) {
    // Preço atual
    const priceEl = document.getElementById("currentPrice");
    if (priceEl) {
      priceEl.textContent = `$${priceData.price.toLocaleString()}`;
    }

    // Mudança 24h
    const changeEl = document.getElementById("change24h");
    if (changeEl && priceData.change24h !== undefined) {
      const change = priceData.change24h;
      changeEl.textContent = `${change >= 0 ? "+" : ""}${change.toFixed(2)}%`;
      changeEl.style.color = change >= 0 ? this.chart.config.colors.bullish : this.chart.config.colors.bearish;
    }

    // Volume 24h
    const volumeEl = document.getElementById("volume24h");
    if (volumeEl && priceData.volume24h) {
      volumeEl.textContent = `${(priceData.volume24h / 1000000).toFixed(1)}M USD`;
    }

    // Última atualização
    const updateEl = document.getElementById("lastUpdate");
    if (updateEl) {
      updateEl.textContent = new Date().toLocaleTimeString();
    }
  }
}

/**
 * Renderizador do gráfico
 */
class ChartRenderer {
  constructor(chart) {
    this.chart = chart;
  }

  render() {
    if (!this.chart.chartContainer || this.chart.candlestickData.length === 0) {
      return;
    }

    this.chart.chartContainer.innerHTML = "";
    
    this.createGrid();
    this.renderCandles();
    this.createAxes();
  }

  createGrid() {
    const gridLines = 8;
    
    // Linhas horizontais
    for (let i = 0; i <= gridLines; i++) {
      const y = (i / gridLines) * this.chart.chartHeight;
      const gridLine = this.createElement("div", "grid-line horizontal", {
        top: `${y}px`,
        left: "0px",
        right: "60px"
      });
      this.chart.chartContainer.appendChild(gridLine);
    }

    // Linhas verticais
    const timeLines = 6;
    for (let i = 0; i <= timeLines; i++) {
      const x = (i / timeLines) * this.chart.chartWidth;
      const gridLine = this.createElement("div", "grid-line vertical", {
        left: `${x}px`,
        top: "0px",
        bottom: "30px"
      });
      this.chart.chartContainer.appendChild(gridLine);
    }
  }

  renderCandles() {
    const candleWidth = Math.max(2, Math.floor((this.chart.chartWidth / this.chart.candlestickData.length) * 0.8));
    const candleSpacing = this.chart.chartWidth / this.chart.candlestickData.length;

    this.chart.candlestickData.forEach((candle, index) => {
      const x = index * candleSpacing + candleSpacing / 2;
      this.createCandle(candle, x, candleWidth);
    });
  }

  createCandle(candle, x, width) {
    const isGreen = candle.c > candle.o;
    const color = isGreen ? this.chart.config.colors.bullish : this.chart.config.colors.bearish;

    const coords = {
      high: this.priceToY(candle.h),
      low: this.priceToY(candle.l),
      open: this.priceToY(candle.o),
      close: this.priceToY(candle.c)
    };

    const bodyTop = Math.min(coords.open, coords.close);
    const bodyBottom = Math.max(coords.open, coords.close);
    const bodyHeight = Math.max(1, bodyBottom - bodyTop);

    // Container da vela
    const candleEl = this.createElement("div", "candle", {
      left: `${x - width / 2}px`,
      width: `${width}px`,
      height: `${this.chart.chartHeight}px`,
      top: "0px"
    });

    // Pavio
    const wick = this.createElement("div", "candle-wick", {
      top: `${coords.high}px`,
      height: `${coords.low - coords.high}px`,
      background: color
    });

    // Corpo
    const body = this.createElement("div", "candle-body", {
      width: "100%",
      height: `${bodyHeight}px`,
      background: color
    });

    candleEl.appendChild(wick);
    candleEl.appendChild(body);

    // Eventos de tooltip
    candleEl.addEventListener("mouseenter", (e) => this.showTooltip(e, candle));
    candleEl.addEventListener("mouseleave", () => this.hideTooltip());

    this.chart.chartContainer.appendChild(candleEl);
  }

  createAxes() {
    this.createYAxis();
    this.createXAxis();
  }

  createYAxis() {
    const yAxis = this.createElement("div", "chart-axis y-axis");
    const priceSteps = 8;

    for (let i = 0; i <= priceSteps; i++) {
      const price = this.chart.priceRange.min + 
        (this.chart.priceRange.max - this.chart.priceRange.min) * (1 - i / priceSteps);
      const y = (i / priceSteps) * this.chart.chartHeight;

      const label = this.createElement("div", "", {
        position: "absolute",
        top: `${y - 6}px`,
        left: "5px",
        fontSize: "10px"
      });
      
      label.textContent = `$${price.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
      yAxis.appendChild(label);
    }

    this.chart.chartContainer.appendChild(yAxis);
  }

  createXAxis() {
    const xAxis = this.createElement("div", "chart-axis x-axis");
    const timeSteps = 6;

    for (let i = 0; i <= timeSteps; i++) {
      const dataIndex = Math.floor(((this.chart.candlestickData.length - 1) * i) / timeSteps);
      
      if (dataIndex < this.chart.candlestickData.length) {
        const candle = this.chart.candlestickData[dataIndex];
        const x = (i / timeSteps) * this.chart.chartWidth;

        const label = this.createElement("div", "", {
          position: "absolute",
          left: `${x - 25}px`,
          top: "5px",
          fontSize: "10px",
          width: "50px",
          textAlign: "center"
        });

        label.textContent = this.formatTime(candle.time);
        xAxis.appendChild(label);
      }
    }

    this.chart.chartContainer.appendChild(xAxis);
  }

  showTooltip(event, candle) {
    const tooltip = document.getElementById("tooltip");
    if (!tooltip) return;

    tooltip.innerHTML = `
      <div><strong>Tempo:</strong> ${candle.time.toLocaleString()}</div>
      <div><strong>Abertura:</strong> $${candle.o.toLocaleString()}</div>
      <div><strong>Alta:</strong> $${candle.h.toLocaleString()}</div>
      <div><strong>Baixa:</strong> $${candle.l.toLocaleString()}</div>
      <div><strong>Fechamento:</strong> $${candle.c.toLocaleString()}</div>
    `;

    tooltip.style.display = "block";
    this.updateTooltipPosition(event, tooltip);

    // Remover listeners anteriores
    document.removeEventListener("mousemove", this.tooltipMoveHandler);
    
    // Adicionar novo listener
    this.tooltipMoveHandler = (e) => this.updateTooltipPosition(e, tooltip);
    document.addEventListener("mousemove", this.tooltipMoveHandler);
  }

  hideTooltip() {
    const tooltip = document.getElementById("tooltip");
    if (tooltip) {
      tooltip.style.display = "none";
    }
    
    // Remover listener
    if (this.tooltipMoveHandler) {
      document.removeEventListener("mousemove", this.tooltipMoveHandler);
      this.tooltipMoveHandler = null;
    }
  }

  updateTooltipPosition(event, tooltip) {
    tooltip.style.left = `${event.pageX - 60}px`;
    tooltip.style.top = `${event.pageY - 100}px`;
  }

  priceToY(price) {
    return this.chart.chartHeight * 
      (1 - (price - this.chart.priceRange.min) / (this.chart.priceRange.max - this.chart.priceRange.min));
  }

  formatTime(date) {
    if (this.chart.currentTimeframe === "1d") {
      return date.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric"
      });
    } else {
      return date.toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit"
      });
    }
  }

  createElement(tag, className = "", styles = {}) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    
    Object.entries(styles).forEach(([property, value]) => {
      element.style[property] = value;
    });

    return element;
  }
}

// Inicialização global
let bitcoinChart;

document.addEventListener("DOMContentLoaded", function() {
  try {
    bitcoinChart = new BitcoinCandlestickChart("candleChart");
    
    // Função global para mudança de timeframe (compatibilidade com HTML existente)
    window.setTimeframe = function(timeframe) {
      if (bitcoinChart) {
        bitcoinChart.setTimeframe(timeframe);
      }
    };
    
  } catch (error) {
    console.error("Erro de inicialização:", error);
  }
});

// Exportar para uso em outros módulos (se necessário)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { BitcoinCandlestickChart, ApiService, ChartRenderer, UIController };
}