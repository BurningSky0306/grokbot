
const NET_INVESTED = 45; // initial capital for this bot subaccount
const REFRESH_MS = 20000;

const fmt = (n, d = 2) => {
  const x = Number(n);
  if (!Number.isFinite(x)) return '—';
  return x.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
};
const signed = (n, d = 2) => {
  const x = Number(n);
  if (!Number.isFinite(x)) return '—';
  return (x >= 0 ? '+' : '−') + fmt(Math.abs(x), d);
};
const color = (n) => (Number(n) >= 0 ? 'up' : 'down');

function baseAsset(instId = '') {
  return String(instId).split('-')[0] || instId || '—';
}
function iconFor(asset) {
  const m = { BTC: '₿', ETH: 'Ξ', SOL: '≋', XRP: '✕', DOGE: 'Ð', PEPE: '🐸', SHIB: '🐕' };
  return m[asset] || asset.slice(0, 1);
}
function formatTime(iso) {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Singapore',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    }).format(new Date(iso)) + ' SGT';
  } catch {
    return iso;
  }
}

let snapshot = null;
let positionsView = [];
let historyView = [];
let equitySeries = [];
let currentTab = 'positions';
let plotted = [];

async function loadSnapshot() {
  const res = await fetch(`/data/trades.json?t=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

function mapPositions(data) {
  const rows = [];
  for (const p of data.positions || []) {
    const pos = Number(p.pos || 0);
    if (!pos) continue;
    const asset = baseAsset(p.instId);
    const avg = Number(p.avgPx || 0);
    const mark = Number(p.markPx || p.last || p.idxPx || avg);
    const upl = Number(p.upl || 0);
    const notional = Math.abs(pos) * Number(p.ctVal || 0) * mark;
    // OKX swap pos is contracts; use availEq/margin if present
    const margin = Number(p.margin || p.imr || p.notionalUsd || 0);
    const value = Number.isFinite(notional) && notional > 0 ? notional : Math.abs(upl) + Math.abs(Number(p.margin || 0));
    rows.push({
      asset,
      instId: p.instId,
      icon: iconFor(asset),
      qty: Math.abs(pos),
      side: pos > 0 ? 'buy' : 'sell',
      lever: p.lever || '2',
      mgnMode: p.mgnMode || 'isolated',
      cost: avg,
      price: mark || avg,
      value: value || Math.abs(upl),
      pnl: upl,
      raw: p,
      reason: findReason(data, p.instId, 'open'),
    });
  }
  return rows;
}

function findReason(data, instId, kind) {
  const decs = [...(data.decisions || [])].reverse();
  for (const d of decs) {
    if (d.instId === instId || d.instId === 'MULTI') {
      return {
        summary: d.summary || '',
        reason: d.reason || '',
        lesson: d.lesson || '',
        at: d.at,
        action: d.action,
      };
    }
  }
  return null;
}

function mapHistory(data) {
  // Use closed/fill-like decisions as history rows (honest: decision log, not full exchange fills ledger)
  const rows = [];
  for (const d of [...(data.decisions || [])].reverse()) {
    if (!d || d.instId === 'MULTI') {
      if (d && (d.action || '').includes('research')) continue;
    }
    const act = d.action || '';
    if (!/(fill|close|tp|sell|open_swap|place_)/.test(act)) continue;
    const asset = baseAsset(d.instId || '');
    rows.push({
      asset,
      instId: d.instId,
      icon: iconFor(asset),
      date: formatTime(d.at),
      action: act,
      summary: d.summary || '',
      reason: d.reason || '',
      lesson: d.lesson || '',
      id: d.ordId || d.id || '—',
      net: null, // unknown unless encoded
    });
  }
  return rows.slice(0, 40);
}

function buildEquitySeries(data) {
  // Do not fabricate a 30-day curve. Use stored equityHistory if present; else start capital + current.
  const hist = Array.isArray(data.equityHistory) ? data.equityHistory.filter((x) => Number.isFinite(Number(x.equity))) : [];
  if (hist.length >= 2) {
    return hist.map((h) => ({ t: h.at || h.t, v: Number(h.equity) }));
  }
  const eq = Number(data.account?.equityUsdtApprox);
  const pts = [{ t: 'start', v: NET_INVESTED }];
  if (Number.isFinite(eq)) pts.push({ t: data.updatedAt || 'now', v: eq });
  return pts;
}

function renderMetrics(data) {
  const eq = Number(data.account?.equityUsdtApprox);
  const pnl = Number.isFinite(eq) ? eq - NET_INVESTED : NaN;
  const ret = Number.isFinite(pnl) ? (pnl / NET_INVESTED) * 100 : NaN;
  const realized = Number(data.account?.realizedPnl);
  const upl = positionsView.reduce((s, r) => s + Number(r.pnl || 0), 0);
  const metrics = document.querySelectorAll('.metric');
  if (metrics[0]) {
    metrics[0].querySelector('.value').textContent = Number.isFinite(eq) ? fmt(eq) : '—';
    metrics[0].querySelector('.sub').innerHTML = Number.isFinite(upl)
      ? `<span class="${color(upl)}">${signed(upl)}</span> 持仓浮动`
      : '—';
  }
  if (metrics[1]) {
    metrics[1].querySelector('.value').textContent = fmt(NET_INVESTED);
    metrics[1].querySelector('.sub').textContent = '初始本金（子账户）· 出金 0.00';
  }
  if (metrics[2]) {
    const el = metrics[2].querySelector('.value');
    el.textContent = signed(pnl);
    el.className = 'value num ' + color(pnl);
    const realTxt = Number.isFinite(realized) ? signed(realized) : '—';
    metrics[2].querySelector('.sub').innerHTML = `已实现 <span class="${color(realized)}">${realTxt}</span> · 浮动 <span class="${color(upl)}">${signed(upl)}</span>`;
  }
  if (metrics[3]) {
    const el = metrics[3].querySelector('.value');
    el.innerHTML = Number.isFinite(ret) ? `${signed(ret)}<span style="font-size:20px">%</span>` : '—';
    el.className = 'value num ' + color(ret);
    metrics[3].querySelector('.sub').textContent = '简单收益 = 净收益 ÷ 净投入';
  }
}

function renderAllocation(data) {
  const eq = Number(data.account?.equityUsdtApprox) || 0;
  // Approximate: USDT cash = eq - sum margins; use position notional weights for display
  let used = 0;
  const parts = positionsView.map((p, i) => {
    const v = Math.max(Math.abs(Number(p.pnl) || 0) + 0.5, Number(p.value) || 1);
    used += Math.abs(Number(p.raw?.margin) || Number(p.raw?.imr) || p.margin || (p.value ? p.value / 2 : 0.5));
    return p;
  });
  // Simpler allocation: each position equal visual share by |upl|+1, cash remainder
  const margins = positionsView.map((p) => Math.abs(Number(p.raw?.margin) || Number(p.raw?.imr) || 0.5));
  const marginSum = margins.reduce((a, b) => a + b, 0);
  const cash = Math.max(eq - marginSum, 0);
  const colors = ['var(--yellow)', '#64748b', '#8a96a7', '#49535f', '#f7931a', '#0ecb81', '#f6465d', '#687bba', '#a8ecd9', '#929aa5', '#3b82f6', '#eab308', '#22c55e', '#ef4444'];
  const slices = [{ name: 'USDT(可用/保证金外)', value: cash, color: colors[0] }];
  positionsView.forEach((p, i) => {
    slices.push({ name: p.instId, value: margins[i] || 0.01, color: colors[(i + 1) % colors.length] });
  });
  const total = slices.reduce((s, x) => s + x.value, 0) || 1;
  let acc = 0;
  const grad = slices.map((s) => {
    const a = (acc / total) * 100;
    acc += s.value;
    const b = (acc / total) * 100;
    return `${s.color} ${a.toFixed(2)}% ${b.toFixed(2)}%`;
  }).join(', ');
  const donut = document.querySelector('.donut');
  if (donut) {
    donut.style.background = `conic-gradient(${grad})`;
    const center = donut.querySelector('.donutcenter');
    if (center) center.innerHTML = `仓位数<b class="num">${positionsView.length}</b>`;
  }
  const cashEl = document.querySelector('.cashvalue');
  if (cashEl) cashEl.textContent = fmt(cash);
  const freeze = document.querySelector('.allocation .small:last-child');
  // second small under cash
  const alloc = document.querySelector('.allocation');
  if (alloc) {
    const smalls = alloc.querySelectorAll('.small');
    if (smalls[1]) smalls[1].textContent = `占用保证金约 ${fmt(marginSum)}`;
  }
  const list = document.querySelector('.allocationlist');
  if (list) {
    list.innerHTML = slices.slice(0, 10).map((s) => {
      const pct = ((s.value / total) * 100).toFixed(2);
      return `<div class="assetrow"><span><i class="swatch" style="background:${s.color}"></i>${s.name}</span><span class="num">${fmt(s.value)}</span><span>${pct}%</span></div>`;
    }).join('');
  }
}

function coinCell(r) {
  const side = r.side === 'buy' ? '<span class="tag buy">多</span>' : '<span class="tag sell">空</span>';
  return `<div class="coin"><span class="coinicon">${r.icon}</span><div><b>${r.asset}<span class="muted" style="font-weight:400"> / SWAP</span></b><div class="secondary">${r.instId} · ${r.lever || '2'}x ${side}</div></div></div>`;
}

function showTab(tab) {
  currentTab = tab;
  document.querySelectorAll('[data-tab]').forEach((b) => {
    const active = b.dataset.tab === tab;
    b.setAttribute('aria-selected', active);
    b.tabIndex = active ? 0 : -1;
  });
  const pos = tab === 'positions';
  const upl = positionsView.reduce((s, r) => s + Number(r.pnl || 0), 0);
  document.getElementById('tableSummary').innerHTML = pos
    ? `<span>永续持仓 <b class="num">${positionsView.length}</b> 个</span><span>浮动盈亏 <b class="num ${color(upl)}" style="color:inherit">${signed(upl)}</b></span>`
    : `<span>决策 / 成交相关记录 · ${historyView.length} 条</span><span class="muted">完整成交流水以 OKX 为准</span>`;
  const headers = pos
    ? ['资产', '持仓数量(张)', '开仓均价', '标记/参考价', '方向杠杆', '浮动盈亏', '交易动机']
    : ['时间（SGT）', '标的 / 动作', '摘要', '订单号', '动机'];
  document.getElementById('tableHead').innerHTML = '<tr>' + headers.map((t) => `<th scope="col">${t}</th>`).join('') + '</tr>';
  if (pos) {
    document.getElementById('tableBody').innerHTML = positionsView.length
      ? positionsView.map((r, i) => `<tr><td>${coinCell(r)}</td><td class="num">${r.qty}<div class="secondary">张</div></td><td class="num">${fmt(r.cost, r.cost < 1 ? 6 : 4)}</td><td class="num">${fmt(r.price, r.price < 1 ? 6 : 4)}</td><td>${r.side === 'buy' ? '<span class="tag buy">多</span>' : '<span class="tag sell">空</span>'} <span class="secondary">${r.lever}x ${r.mgnMode || ''}</span></td><td class="pnl num ${color(r.pnl)}">${signed(r.pnl, 4)}</td><td><button class="rationale" data-detail="${i}">查看动机 ↗</button></td></tr>`).join('')
      : '<tr><td colspan="7" class="muted" style="text-align:center;padding:28px">当前无持仓</td></tr>';
    document.getElementById('tableBottom').innerHTML = `<span>风控：≤2x · 单笔保证金≤10U · 日亏约9U停手</span><span>共 ${positionsView.length} 个仓位</span>`;
    const count = document.querySelector('#tab-positions .count');
    if (count) count.textContent = String(positionsView.length);
  } else {
    document.getElementById('tableBody').innerHTML = historyView.length
      ? historyView.map((r, i) => `<tr><td class="num">${r.date}</td><td><b>${r.instId || r.asset}</b><div class="secondary">${r.action}</div></td><td style="white-space:normal;max-width:360px;text-align:left">${r.summary || '—'}</td><td class="num muted">${r.id}</td><td><button class="rationale" data-detail="${i}">查看动机 ↗</button></td></tr>`).join('')
      : '<tr><td colspan="5" class="muted" style="text-align:center;padding:28px">暂无历史决策</td></tr>';
    document.getElementById('tableBottom').innerHTML = `<span>来自 Grok 决策日志（含开仓/平仓/同步说明）</span><span>共 ${historyView.length} 条</span>`;
    const count = document.querySelector('#tab-history .count');
    if (count) count.textContent = String(historyView.length);
  }
}

function renderReason(data) {
  const latest = [...(data.decisions || [])].reverse().find(Boolean);
  const intro = document.querySelector('.reasonintro p');
  const tag = document.querySelector('.reasonintro .tag');
  if (tag) {
    tag.textContent = latest ? '已更新' : '待填写';
    tag.className = latest ? 'tag' : 'tag';
  }
  if (intro) intro.innerHTML = latest
    ? `最近一次策略判断 <span class="muted">/ ${formatTime(latest.at)}</span>`
    : '最近一次策略判断 <span class="muted">/ —</span>';
  const ph = document.querySelector('.placeholder');
  if (!ph) return;
  if (!latest) return;
  ph.innerHTML = `
    <div><h3><span class="yellow">01</span> &nbsp;市场判断 / 动作</h3><p>${escapeHtml(latest.summary || latest.action || '—')}</p><div class="fieldline"></div></div>
    <div><h3><span class="yellow">02</span> &nbsp;交易计划 / 理由</h3><p>${escapeHtml(latest.reason || '—')}</p><div class="fieldline"></div></div>
    <div><h3><span class="yellow">03</span> &nbsp;教训 / 失效条件</h3><p>${escapeHtml(latest.lesson || '—')}</p><div class="fieldline"></div></div>`;
}

function escapeHtml(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function drawChart() {
  const values = equitySeries.map((p) => p.v);
  const svg = document.getElementById('equityChart');
  const tip = document.getElementById('chartTooltip');
  if (!svg) return;
  if (values.length < 2) {
    svg.innerHTML = `<text x="40" y="110" fill="#929aa5" font-size="13">权益曲线样本不足（需要历史快照）。当前仅有起点与最新权益，不会伪造 30 天曲线。</text>`;
    plotted = [];
    document.getElementById('rangeLabel').textContent = '样本不足';
    document.getElementById('rangeReturn').textContent = '—';
    tip.hidden = true;
    return;
  }
  const min = Math.min(...values, NET_INVESTED) * 0.995;
  const max = Math.max(...values, NET_INVESTED) * 1.005;
  const span = Math.max(max - min, 0.01);
  const X = (i) => 14 + (i / (values.length - 1)) * 761;
  const Y = (v) => 184 - ((v - min) / span) * 165;
  plotted = values.map((v, i) => ({
    x: X(i),
    y: Y(v),
    v,
    date: equitySeries[i].t === 'start' ? '起点' : String(equitySeries[i].t).slice(5, 16),
  }));
  const points = plotted.map((p) => `${p.x},${p.y}`).join(' ');
  const gridVals = [min, min + span * 0.25, min + span * 0.5, min + span * 0.75, max];
  svg.innerHTML =
    `<defs><linearGradient id="fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fcd535" stop-opacity=".17"/><stop offset="1" stop-color="#fcd535" stop-opacity="0"/></linearGradient></defs>` +
    gridVals.map((v) => `<line x1="14" x2="775" y1="${Y(v)}" y2="${Y(v)}" stroke="#2b3139" stroke-width=".7"/><text x="798" y="${Y(v) + 4}">${fmt(v, 2)}</text>`).join('') +
    `<line x1="14" x2="775" y1="${Y(NET_INVESTED)}" y2="${Y(NET_INVESTED)}" stroke="#929aa5" stroke-dasharray="4 5"/>` +
    `<polygon points="14,184 ${points} 775,184" fill="url(#fade)"/><polyline points="${points}" fill="none" stroke="#fcd535" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>` +
    `<circle cx="${plotted.at(-1).x}" cy="${plotted.at(-1).y}" r="4" fill="#fcd535"/>` +
    `<line id="crosshair" x1="0" x2="0" y1="15" y2="185" stroke="#929aa5" stroke-dasharray="3 4" visibility="hidden"/>`;
  document.getElementById('rangeLabel').textContent = `${plotted[0].date} — ${plotted.at(-1).date}`;
  document.getElementById('rangeReturn').textContent = signed(values.at(-1) - values[0]) + ' USDT';
  const endStrong = document.querySelectorAll('.chartfooter strong.num');
  if (endStrong[1]) endStrong[1].textContent = fmt(values.at(-1)) + ' USDT';
}

function bindChartHover() {
  const chart = document.getElementById('equityChart');
  const tip = document.getElementById('chartTooltip');
  if (!chart || chart.dataset.bound) return;
  chart.dataset.bound = '1';
  chart.addEventListener('pointermove', (e) => {
    if (!plotted.length) return;
    const r = chart.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * 860;
    const p = plotted.reduce((a, b) => (Math.abs(a.x - x) < Math.abs(b.x - x) ? a : b));
    tip.innerHTML = `${p.date} · 账户权益<strong>${fmt(p.v)} <span class="unit">USDT</span></strong>`;
    tip.hidden = false;
    tip.style.left = Math.max(0, Math.min(r.width - 165, (p.x / 860) * r.width - 70)) + 'px';
    const line = document.getElementById('crosshair');
    if (line) {
      line.setAttribute('x1', p.x);
      line.setAttribute('x2', p.x);
      line.setAttribute('visibility', 'visible');
    }
  });
  chart.addEventListener('pointerleave', () => {
    tip.hidden = true;
    const line = document.getElementById('crosshair');
    if (line) line.setAttribute('visibility', 'hidden');
  });
}

function openDetail(i) {
  const dialog = document.getElementById('detailDialog');
  const pos = currentTab === 'positions';
  const r = (pos ? positionsView : historyView)[i];
  if (!r) return;
  document.getElementById('detailTitle').textContent = pos
    ? `${r.instId} · 当前持仓`
    : `${r.instId || r.asset} · ${r.action}`;
  const fields = pos
    ? [
        ['数量(张)', String(r.qty)],
        ['开仓均价', fmt(r.cost, 6)],
        ['参考价', fmt(r.price, 6)],
        ['浮动盈亏', signed(r.pnl, 4) + ' USDT'],
      ]
    : [
        ['时间', r.date],
        ['动作', r.action || '—'],
        ['订单号', r.id || '—'],
        ['摘要', r.summary || '—'],
      ];
  document.getElementById('detailValues').innerHTML = fields
    .map(([label, value]) => `<div><span class="small">${label}</span><strong class="num">${escapeHtml(String(value))}</strong></div>`)
    .join('');
  const reason = pos ? r.reason : { reason: r.reason, lesson: r.lesson, summary: r.summary };
  const body = dialog.querySelector('.dialogbody');
  const fieldsReason = body.querySelectorAll('.reasonfield');
  if (fieldsReason[0]) fieldsReason[0].querySelector('p').textContent = reason?.reason || reason?.summary || '— 暂无入场依据';
  if (fieldsReason[1]) fieldsReason[1].querySelector('p').textContent = reason?.summary || '— 见决策摘要';
  if (fieldsReason[2]) fieldsReason[2].querySelector('p').textContent = reason?.lesson || '— 暂无退出/失效条件';
  const tag = body.querySelector('.tag');
  if (tag) tag.textContent = reason?.reason ? 'Grok 已填写' : 'Grok 待补充';
  dialog.showModal();
}

function bindUi() {
  document.querySelectorAll('[data-tab]').forEach((b) => {
    b.addEventListener('click', () => showTab(b.dataset.tab));
  });
  document.getElementById('tableBody').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-detail]');
    if (!btn) return;
    openDetail(Number(btn.dataset.detail));
  });
  const dialog = document.getElementById('detailDialog');
  document.getElementById('closeDialog').onclick = () => dialog.close();
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });
  document.querySelectorAll('[data-period]').forEach((b) => {
    b.addEventListener('click', () => {
      // Only real series; period buttons kept for UX but do not invent points
      document.querySelectorAll('[data-period]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      drawChart();
    });
  });
  bindChartHover();
}

async function refresh() {
  try {
    const data = await loadSnapshot();
    snapshot = data;
    positionsView = mapPositions(data);
    historyView = mapHistory(data);
    equitySeries = buildEquitySeries(data);
    document.getElementById('snapTime').textContent = formatTime(data.updatedAt);
    document.getElementById('snapNote').textContent = '来自 trades.json · Cloudflare 部署快照';
    const risk = data.account?.risk || {};
    renderMetrics(data);
    renderAllocation(data);
    renderReason(data);
    showTab(currentTab);
    drawChart();
    // counts
    const pc = document.querySelector('#tab-positions .count');
    const hc = document.querySelector('#tab-history .count');
    if (pc) pc.textContent = String(positionsView.length);
    if (hc) hc.textContent = String(historyView.length);
  } catch (err) {
    console.warn(err);
    document.getElementById('snapNote').textContent = '获取失败：' + err.message;
    document.getElementById('liveTag').innerHTML = '<i class="dot" style="color:var(--red)"></i>快照读取失败';
  }
}

bindUi();
refresh();
setInterval(refresh, REFRESH_MS);
