# grokbot

OKX learning dashboard for Cloudflare Pages.

## Dev

```bash
npm install
npm run dev
```

## Deploy

```bash
npm run build
npx wrangler pages deploy dist --project-name=grokbot
```

Custom domain: Pages > grokbot > Custom domains.

Trade log: public/data/trades.json (no OKX secrets).

Disclaimer: for learning only.
