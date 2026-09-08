/**
 * Cloudflare Pages Function — 代理 OKX 公开 REST（无密钥）
 * 浏览器请求: /api/okx/api/v5/market/ticker?instId=BTC-USDT
 * 转发至:     https://www.okx.com/api/v5/market/ticker?instId=BTC-USDT
 */
export async function onRequestGet(context) {
  const incoming = new URL(context.request.url);
  const path = context.params.path;
  const suffix = Array.isArray(path) ? path.join('/') : path || '';
  const target = new URL(`https://www.okx.com/${suffix}`);
  target.search = incoming.search;

  try {
    const upstream = await fetch(target.toString(), {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'grokbot-learning-dashboard/1.0',
      },
      cf: { cacheTtl: 5, cacheEverything: true },
    });
    const body = await upstream.text();
    return new Response(body, {
      status: upstream.status,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'public, max-age=5',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ code: '1', msg: String(err) }), {
      status: 502,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }
}
