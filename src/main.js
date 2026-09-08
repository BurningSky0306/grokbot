const INST_IDS = ['BTC-USDT', 'ETH-USDT'];
const REFRESH_MS = 15_000;

const el = {
  clock: document.getElementById('clock'),
  equity: document.getElementById('equity'),
  marketStatus: document.getElementById('market-status'),
  tickers: document.getElementById('tickers'),
  orders: document.getElementById('orders'),
  ordersCount: document.getElementById('orders-count'),
  decisions: document.getElementById('decisions'),
  updatedAt: document.getElementById('updated-at'),
  refresh: document.getElementById('btn-refresh'),
};

function formatPrice(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return '—';
  if (x >= 1000) return x.toLocaleString('zh-CN', { maximumFractionDigits: 1 });
  if (x >= 1) return x.toLocaleString('zh-CN', { maximumFractionDigits: 4 });
  return x.toLocaleString('zh-CN', { maximumFractionDigits: 6 });
}

function formatPct(last, open24h) {
  const a = Number(last);
  const b = Number(open24h);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return { text: '—', cls: '' };
  const pct = ((a - b) / b) * 100;
  const sign = pct > 0 ? '+' : '';
  return {
    text: `${sign}${pct.toFixed(2)}%`,
    cls: pct > 0 ? 'up' : pct < 0 ? 'down' : '',
  };
}

function formatTime(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Singapore',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(d) + ' SGT';
  } catch {
    return iso;
  }
}

function tickClock() {
  const now = new Date();
  el.clock.textContent = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Singapore',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(now) + ' SGT';
}

/** Prefer Pages Function / Vite proxy; fall back to public OKX URL. */
async function fetchTicker(instId) {
  const paths = [
    `/api/okx/api/v5/market/ticker?instId=${encodeURIComponent(instId)}`,
    `https://www.okx.com/api/v5/market/ticker?instId=${encodeURIComponent(instId)}`,
  ];
  let lastErr;
  for (const url of paths) {
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (json.code !== '0' || !json.data?.[0]) throw new Error(json.msg || '无效响应');
      return json.data[0];
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('行情拉取失败');
}

async function loadMarket() {
  el.marketStatus.textContent = '刷新中';
  el.marketStatus.className = 'pill muted';
  try {
    const rows = await Promise.all(INST_IDS.map((id) => fetchTicker(id)));
    const html = rows
      .map((t) => {
        const chg = formatPct(t.last, t.open24h);
        return `<article class="ticker" data-inst="${t.instId}">
          <div class="ticker-name">${t.instId}</div>
          <div class="ticker-price mono">${formatPrice(t.last)}</div>
          <div class="ticker-chg ${chg.cls}">24h ${chg.text}</div>
        </article>`;
      })
      .join('');
    el.tickers.innerHTML = html;
    el.marketStatus.textContent = '已连接';
    el.marketStatus.className = 'pill ok';
  } catch (err) {
    console.warn(err);
    el.marketStatus.textContent = '行情失败';
    el.marketStatus.className = 'pill err';
  }
}

function renderOrders(orders = []) {
  el.ordersCount.textContent = String(orders.length);
  if (!orders.length) {
    el.orders.innerHTML = '<div class="empty">当前无挂单</div>';
    return;
  }
  el.orders.innerHTML = orders
    .map((o) => {
      const sideCls = o.side === 'buy' ? 'buy' : 'sell';
      const sideZh = o.side === 'buy' ? '买入' : '卖出';
      const typeZh = o.ordType === 'limit' ? '限价' : o.ordType || '—';
      const stateZh = o.state === 'live' ? '等待成交' : o.state || '—';
      return `<article class="order">
        <div class="order-row">
          <div><span class="order-side ${sideCls}">${sideZh}</span> · ${o.instId}</div>
          <span class="pill muted">${stateZh}</span>
        </div>
        <div class="order-meta mono">
          <span><span>类型</span><strong>${typeZh}</strong></span>
          <span><span>价格</span><strong>${formatPrice(o.px)}</strong></span>
          <span><span>数量</span><strong>${o.sz}</strong></span>
          <span><span>约合</span><strong>~${o.notionalUsdtApprox ?? '—'} USDT</strong></span>
          <span><span>ordId</span><strong>${o.ordId}</strong></span>
          <span><span>clOrdId</span><strong>${o.clOrdId || '—'}</strong></span>
          <span><span>时间</span><strong>${formatTime(o.createdAt)}</strong></span>
        </div>
      </article>`;
    })
    .join('');
}

function renderDecisions(decisions = []) {
  if (!decisions.length) {
    el.decisions.innerHTML = '<div class="empty">尚无决策记录。下单后请写下理由与教训。</div>';
    return;
  }
  const sorted = [...decisions].sort((a, b) => String(b.at).localeCompare(String(a.at)));
  el.decisions.innerHTML = sorted
    .map(
      (d) => `<article class="decision">
        <div class="decision-time mono">${formatTime(d.at)} · ${d.instId || ''} · ${d.action || ''}</div>
        <div class="decision-summary">${d.summary || '—'}</div>
        <blockquote>${d.reason || '（未填写理由）'}</blockquote>
        <div class="lesson">${d.lesson || '（未填写教训）'}</div>
      </article>`
    )
    .join('');
}

async function loadJournal() {
  const res = await fetch(`/data/trades.json?t=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`trades.json HTTP ${res.status}`);
  const data = await res.json();
  const equity = data?.account?.equityUsdtApprox;
  if (equity != null) el.equity.textContent = `${equity} USDT`;
  renderOrders(data.openOrders || []);
  renderDecisions(data.decisions || []);
  el.updatedAt.textContent = `日志更新：${formatTime(data.updatedAt)}`;
}

async function refreshAll() {
  tickClock();
  await Promise.all([loadMarket(), loadJournal().catch((e) => {
    console.warn(e);
    el.orders.innerHTML = `<div class="empty">无法加载 trades.json：${e.message}</div>`;
    el.decisions.innerHTML = '';
  })]);
}

el.refresh.addEventListener('click', () => refreshAll());
tickClock();
setInterval(tickClock, 1000);
refreshAll();
setInterval(loadMarket, REFRESH_MS);
