# Arcora — Stablecoin Checkout for WooCommerce

Adds a payment gateway to WooCommerce that routes orders through Arcora's hosted stablecoin checkout. Customer pays USDC or EURC; merchant receives the stable they configured (USDC or EURC) on Arc Network. Atomic settlement, sub-second finality, and refunds delivered in the payout token.

> **Status:** v0.1 scaffold. The plugin is functional but has not been load-tested against a live WordPress + WooCommerce install yet. Expect to read the source before deploying to production. PRs welcome.

## What ships

- **Payment gateway** registered in WooCommerce admin (Settings → Payments → Arcora). Standard fields: enabled, title, description, API key, environment (testnet / mainnet), pay-in token, settlement token.
- **Order placement flow** — when the customer clicks *Place order*, the plugin POSTs to Arcora's `/api/invoices`, stores the returned `invoiceId` on the order, and redirects to the hosted checkout URL.
- **Webhook listener** at `/wc-api/wc_arcora_webhook` verifies `X-Arcora-Signature` (HMAC-SHA256 over the raw body, prefix `sha256=`) against the per-merchant webhook secret. Handles `invoice.paid` (→ marks the order `completed` via `payment_complete()`) and `invoice.refunded` (→ marks the order `refunded`).
- **Refund support flag** — `$this->supports = ['products', 'refunds']` so the WooCommerce admin shows the refund UI on the order screen. Note: today the actual refund execution still happens in Arcora's merchant dashboard / SDK; the plugin only mirrors status. Full WC-driven refund triggering is a v0.2 task.

## Install

There's no `wp install plugin` entry yet — clone the repo and zip the plugin directory by hand, or copy it into your WordPress install:

```bash
git clone https://github.com/arcoralabs/arcorapay.git
cd arcorapay/plugins/arcora-woocommerce
zip -r arcora-woocommerce.zip . -x ".*"
# Then in WP admin → Plugins → Add new → Upload plugin → arcora-woocommerce.zip
```

After activation:

1. WooCommerce → Settings → Payments → enable **Arcora**.
2. Paste your Arcora API key (from the Arcora dashboard → Settings → API key).
3. Choose **Testnet** while developing; flip to **Mainnet** only when live.
4. Pick the settlement token (USDC or EURC) — this is what Arcora pays into your wallet.
5. Copy the **Webhook URL** field into the Arcora dashboard → Webhooks. Arcora returns a secret — paste it back into the **Webhook secret** field on the same WC settings screen.

## Limitations (v0.1)

- **USD-only stores.** WooCommerce currency must be set to `USD`. Other currencies fail at order placement with a clear message. v1.x adds proper FX once Arcora ships multi-currency invoices.
- **No subscriptions / recurring billing.** Arcora doesn't ship recurring invoices yet (v3.0+ on the roadmap).
- **No HPOS-explicit declaration.** WooCommerce's High-Performance Order Storage works through the abstraction we use, but v0.2 should add the `before_woocommerce_init` declaration to be explicit.
- **WC-driven refund execution not wired yet.** The gateway declares `refunds` support so the WC refund button shows up, but actual refund execution still happens in the Arcora dashboard. v0.2 adds a `process_refund()` implementation that calls Arcora's refund API.

## Local development

There's no PHP test harness in this repo. To iterate:

1. Set up a WordPress + WooCommerce sandbox (e.g. via [Local](https://localwp.com/) or `docker run wordpress`).
2. Copy this directory into `wp-content/plugins/`.
3. Activate, configure, place a test order, watch the network tab for the `/api/invoices` POST.
4. Use `ngrok http 80` so Arcora's webhook can reach your sandbox while testing locally.

## Source

[github.com/arcoralabs/arcorapay](https://github.com/arcoralabs/arcorapay) — `plugins/arcora-woocommerce/`

## License

MIT.
