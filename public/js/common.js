/* common.js - funções compartilhadas por todas as páginas.
   O frontend fala SOMENTE com /api/* (o nosso servidor); nunca com APIs externas. */
"use strict";

/** Escapa texto para uso seguro em innerHTML (evita XSS com dados vindos de APIs). */
function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

/** Só aceita links http(s) vindos das notícias. */
function safeUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : "#";
  } catch { return "#"; }
}

/** Atalho para document.querySelector. */
const $ = (sel, root = document) => root.querySelector(sel);

/** Chamada ao backend. Lança Error com a mensagem amigável enviada pelo servidor. */
async function api(path, { method = "GET", body } = {}) {
  let resp;
  try {
    resp = await fetch("/api" + path, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error("Sem conexão com o servidor.");
  }
  let data = null;
  try { data = await resp.json(); } catch { /* resposta sem JSON */ }
  if (!resp.ok) throw new Error((data && data.error) || `Erro ${resp.status}`);
  return data;
}

/** Formata número no padrão brasileiro. Preços pequenos ganham mais casas. */
function fmtNum(n, digits) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return "—";
  const v = Number(n);
  const d = digits ?? (Math.abs(v) >= 1000 ? 2 : Math.abs(v) >= 1 ? 2 : 4);
  return v.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
}

function fmtMoney(n, currency = "BRL") {
  if (n === null || n === undefined) return "—";
  try {
    return Number(n).toLocaleString("pt-BR", { style: "currency", currency });
  } catch { return fmtNum(n); }
}

function fmtCompact(n) {
  if (n === null || n === undefined) return "—";
  return Number(n).toLocaleString("pt-BR", { notation: "compact", maximumFractionDigits: 2 });
}

/** HTML de variação percentual colorida (verde/vermelho). */
function pctHtml(pct, badge = false) {
  if (pct === null || pct === undefined) return "—";
  const cls = pct >= 0 ? "up" : "down";
  const sign = pct > 0 ? "+" : "";
  return `<span class="${cls}${badge ? " badge " + cls : ""}">${sign}${fmtNum(pct, 2)}%</span>`;
}

function timeAgo(dateStr) {
  const t = Date.parse(dateStr);
  if (!t) return "";
  const mins = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (mins < 60) return `há ${mins} min`;
  if (mins < 1440) return `há ${Math.round(mins / 60)} h`;
  return new Date(t).toLocaleDateString("pt-BR");
}

const loading = (msg = "Carregando…") => `<div class="state"><span class="spinner"></span>${esc(msg)}</div>`;
const errorBox = (msg) => `<div class="error">${esc(msg)}</div>`;

/** Nome amigável para símbolos técnicos. */
const NAMES = {
  "^BVSP": "Ibovespa", "^GSPC": "S&P 500", "^IXIC": "Nasdaq", "^DJI": "Dow Jones",
  "^FTSE": "FTSE 100", "^N225": "Nikkei 225", "USD-BRL": "Dólar", "EUR-BRL": "Euro",
  "GBP-BRL": "Libra", "JPY-BRL": "Iene", "ARS-BRL": "Peso argentino", "CAD-BRL": "Dólar canadense",
  "AUD-BRL": "Dólar australiano", "CHF-BRL": "Franco suíço", "CNY-BRL": "Yuan", "EUR-USD": "Euro / Dólar",
  "GBP-USD": "Libra / Dólar",
};
const niceName = (q) => NAMES[q.symbol] || q.name || q.symbol;

/* ---------- Layout comum: cabeçalho, navegação e faixa de cotações ---------- */

const PAGES = [
  ["index.html", "Mercados"], ["moedas.html", "Moedas"], ["cripto.html", "Cripto"],
  ["noticias.html", "Notícias"], ["ia.html", "Consultoria IA"],
];

function renderLayout(active) {
  const nav = PAGES.map(([href, label]) =>
    `<a href="/${href}" class="${href === active ? "active" : ""}">${label}</a>`).join("");
  document.body.insertAdjacentHTML("afterbegin", `
    <header class="topbar"><div class="topbar-in">
      <a class="brand" href="/index.html"><span class="brand-dot">▲</span>Painel Financeiro</a>
      <nav class="nav">${nav}</nav>
    </div></header>
    <div class="ticker"><div class="ticker-in" id="ticker">${loading("Cotações…")}</div></div>`);
  document.body.insertAdjacentHTML("beforeend",
    `<div class="foot">Dados com atraso possível. Conteúdo informativo, não é recomendação de investimento.</div>`);
  loadTicker();
  setInterval(loadTicker, 30000); // atualiza a faixa a cada 30 s
}

async function loadTicker() {
  const box = $("#ticker");
  try {
    const { quotes } = await api("/quotes?symbols=USD-BRL,EUR-BRL,^BVSP,^GSPC,BTC-BRL,ETH-BRL");
    box.innerHTML = quotes.map((q) =>
      `<div class="tick"><b>${esc(niceName(q))}</b><span>${fmtNum(q.price)}</span>${pctHtml(q.change_pct)}</div>`
    ).join("") || "";
  } catch { box.innerHTML = '<span class="tick">Cotações indisponíveis no momento</span>'; }
}

/* ---------- Gráfico de candles (TradingView Lightweight Charts) ---------- */

/** Carrega a biblioteca de gráficos tentando várias CDNs, uma após a outra. */
const CHART_LIB_URLS = [
  "https://cdn.jsdelivr.net/npm/lightweight-charts@4.1.3/dist/lightweight-charts.standalone.production.js",
  "https://unpkg.com/lightweight-charts@4.1.3/dist/lightweight-charts.standalone.production.js",
  "https://cdnjs.cloudflare.com/ajax/libs/lightweight-charts/4.1.3/lightweight-charts.standalone.production.js",
];
let chartLibPromise = null;
function loadChartLib() {
  if (window.LightweightCharts) return Promise.resolve(true);
  if (!chartLibPromise) {
    chartLibPromise = (async () => {
      for (const src of CHART_LIB_URLS) {
        const ok = await new Promise((resolve) => {
          const s = document.createElement("script");
          s.src = src; s.onload = () => resolve(true); s.onerror = () => { s.remove(); resolve(false); };
          document.head.appendChild(s);
        });
        if (ok && window.LightweightCharts) return true;
      }
      return false;
    })();
  }
  return chartLibPromise;
}

const RANGES = [
  ["1d", "5m", "1D"], ["5d", "15m", "5D"], ["1mo", "60m", "1M"],
  ["3mo", "1d", "3M"], ["1y", "1d", "1A"], ["5y", "1wk", "5A"],
];

/**
 * Painel de gráfico reutilizável.
 * opts: { el, symbols: [símbolos], initial }
 * Retorna { setSymbol(sym) } para outras partes da página trocarem o ativo.
 */
function createChartPanel({ el, symbols, initial }) {
  let symbol = initial || symbols[0];
  let rangeIdx = 3; // 3M por padrão
  let chart, series, volume, token = 0;

  el.innerHTML = `
    <div class="card-head">
      <div class="chart-meta"><h2 id="cp-title"></h2><span class="chart-price" id="cp-price"></span><span id="cp-chg"></span></div>
      <div class="pills" id="cp-ranges">${RANGES.map((r, i) =>
        `<button class="pill ${i === rangeIdx ? "active" : ""}" data-i="${i}">${r[2]}</button>`).join("")}</div>
    </div>
    <div class="chart" id="cp-chart"></div>`;

  const box = $("#cp-chart", el);

  function ensureChart() {
    if (chart) return;
    const css = getComputedStyle(document.documentElement);
    const green = css.getPropertyValue("--green").trim(), red = css.getPropertyValue("--red").trim();
    chart = LightweightCharts.createChart(box, {
      autoSize: true,
      layout: { background: { color: "#ffffff" }, textColor: "#6a7f73", fontFamily: "inherit" },
      grid: { vertLines: { color: "#eef3f0" }, horzLines: { color: "#eef3f0" } },
      rightPriceScale: { borderColor: "#e3ebe6" },
      timeScale: { borderColor: "#e3ebe6", timeVisible: true, secondsVisible: false },
      crosshair: { mode: 0 },
    });
    series = chart.addCandlestickSeries({
      upColor: green, borderUpColor: green, wickUpColor: green,
      downColor: red, borderDownColor: red, wickDownColor: red,
    });
    volume = chart.addHistogramSeries({ priceFormat: { type: "volume" }, priceScaleId: "vol" });
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
  }

  async function load() {
    const my = ++token; // ignora respostas antigas se o usuário clicar rápido
    $("#cp-title", el).textContent = NAMES[symbol] || symbol;
    try {
      const [, interval] = RANGES[rangeIdx];
      const data = await api(`/candles?symbol=${encodeURIComponent(symbol)}&range=${RANGES[rangeIdx][0]}&interval=${interval}`);
      if (my !== token) return;
      if (!(await loadChartLib())) throw new Error("Biblioteca de gráficos não carregou (verifique a conexão ou bloqueadores de anúncio).");
      if (my !== token) return;
      ensureChart();
      if (!chart) return;
      // Lightweight Charts exige tempos estritamente crescentes e sem duplicados
      const seen = new Set();
      const candles = data.candles.filter((c) => !seen.has(c.time) && seen.add(c.time)).sort((a, b) => a.time - b.time);
      if (!candles.length) throw new Error("Sem dados para este período.");
      series.setData(candles.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })));
      const css = getComputedStyle(document.documentElement);
      volume.setData(candles.map((c) => ({
        time: c.time, value: c.volume,
        color: (c.close >= c.open ? css.getPropertyValue("--green") : css.getPropertyValue("--red")).trim() + "55",
      })));
      chart.timeScale().fitContent();
      const last = candles[candles.length - 1], first = candles[0];
      const pct = (last.close / first.open - 1) * 100;
      $("#cp-price", el).textContent = fmtNum(last.close);
      $("#cp-chg", el).innerHTML = pctHtml(pct, true) + ` <small style="color:var(--muted)">${esc(data.currency || "")} no período</small>`;
    } catch (e) {
      if (my === token) { $("#cp-price", el).textContent = ""; $("#cp-chg", el).innerHTML = errorBox(e.message); }
    }
  }

  $("#cp-ranges", el).addEventListener("click", (ev) => {
    const b = ev.target.closest("button"); if (!b) return;
    rangeIdx = Number(b.dataset.i);
    el.querySelectorAll("#cp-ranges .pill").forEach((p) => p.classList.toggle("active", p === b));
    load();
  });

  load();
  return { setSymbol(s) { symbol = s; load(); } };
}

/* ---------- Tabela de cotações reutilizável ---------- */

/**
 * Preenche uma tabela com cotações. onSelect(symbol) é chamado ao clicar numa linha.
 * Atualiza sozinha a cada 30 s.
 */
function createQuoteTable({ el, symbols, onSelect }) {
  el.innerHTML = `<div class="table-wrap"><table>
    <thead><tr><th>Nome</th><th>Último</th><th>Máx.</th><th>Mín.</th><th>Var.</th><th>Var. %</th></tr></thead>
    <tbody><tr><td colspan="6">${loading()}</td></tr></tbody></table></div>`;
  const tbody = $("tbody", el);
  let selected = symbols[0];

  async function refresh() {
    try {
      const { quotes } = await api("/quotes?symbols=" + symbols.join(","));
      tbody.innerHTML = quotes.map((q) => `
        <tr class="clickable ${q.symbol === selected ? "selected" : ""}" data-sym="${esc(q.symbol)}">
          <td class="sym">${esc(niceName(q))}<small>${esc(q.symbol)}</small></td>
          <td>${fmtNum(q.price)}</td><td>${q.high ? fmtNum(q.high) : "—"}</td><td>${q.low ? fmtNum(q.low) : "—"}</td>
          <td class="${q.change >= 0 ? "up" : "down"}">${q.change > 0 ? "+" : ""}${fmtNum(q.change)}</td>
          <td>${pctHtml(q.change_pct)}</td>
        </tr>`).join("") || `<tr><td colspan="6" class="state">Sem dados.</td></tr>`;
    } catch (e) { tbody.innerHTML = `<tr><td colspan="6">${errorBox(e.message)}</td></tr>`; }
  }

  tbody.addEventListener("click", (ev) => {
    const tr = ev.target.closest("tr[data-sym]"); if (!tr) return;
    selected = tr.dataset.sym;
    tbody.querySelectorAll("tr").forEach((r) => r.classList.toggle("selected", r === tr));
    if (onSelect) onSelect(selected);
  });

  refresh();
  setInterval(refresh, 30000);
}
