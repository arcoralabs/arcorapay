# @arcora/sdk

Stripe-style checkout SDK for [Arcorapay](https://github.com/arcoralabs/arcorapay) — stablecoin payments on Arc Network. Three functions, zero EVM dependencies, ~1.5 KB gzipped.

## Install

```bash
npm install @arcora/sdk
# or
pnpm add @arcora/sdk
```

For React: `npm install @arcora/sdk-react`

## Two key types — read this first

Your dashboard gives you **two** keys:

| Key | Prefix | Where it goes | Can do |
|-----|--------|---------------|--------|
| **Publishable** | `pk_live_…` | Browser / client code — **safe to embed** | Create a checkout from one of your allowlisted origins |
| **Secret** | `ak_live_…` | **Server-side only — never ship to the browser** | Everything: create invoices, list escrows, read private invoice data |

Use the **publishable** key in any code that runs in a browser (the `<script>`
tag, React components, anything bundled into your site). Keep the **secret**
key on your server — anyone who views your page can read a key embedded in it,
and a secret key lets them create invoices and read your merchant data.
`escrows()` and other privileged reads require the secret key and only work
server-side. Set your allowed origins in the dashboard so publishable-key
checkouts are accepted.

### Drop-in `<script>` tag (no build step)

For sites without a bundler — static HTML, simple WordPress themes, anything that can host a script tag — use the IIFE bundle from a CDN with your **publishable** key:

```html
<script src="https://cdn.jsdelivr.net/npm/@arcora/sdk@1.1/dist/arcora.global.js"></script>
<script>
  Arcora.init({ apiKey: "pk_live_…", environment: "testnet" }); // publishable key — safe in the browser
  document.getElementById("pay").addEventListener("click", async () => {
    const inv = await Arcora.createInvoice({
      amountUsdc: 49.99,
      payInToken: "EURC",
      successUrl: window.location.origin + "/?paid=1",
    });
    Arcora.openCheckout(inv);
  });
</script>
<button id="pay">Pay €49.99</button>
```

Same surface as the npm package, flattened onto a global `Arcora`. Works in any modern browser; ~1.8 KB minified.

## Usage

```ts
import { Arcora } from "@arcora/sdk";

// Browser code → publishable key. (On a server, use your secret ak_live_ key.)
Arcora.init({ apiKey: "pk_live_...", environment: "testnet" });

const invoice = await Arcora.createInvoice({
  amountUsdc: 49.99,
  payInToken: "EURC",
  successUrl: "https://my-store.com/success",
});

Arcora.openCheckout(invoice);
```

### React

```tsx
import { CheckoutButton } from "@arcora/sdk-react";

<CheckoutButton
  apiKey="pk_live_..." /* publishable key — this runs in the browser */
  environment="testnet"
  invoice={{
    amountUsdc: 49.99,
    payInToken: "EURC",
    successUrl: "https://my-store.com/success",
  }}
>
  Pay €49.99
</CheckoutButton>
```

### Hook

```tsx
import { useCheckout } from "@arcora/sdk-react";

const { checkout, loading, error } = useCheckout({ apiKey: "pk_live_..." }); // publishable key

<button onClick={() => checkout({ amountUsdc: 49.99, payInToken: "EURC", successUrl: "..." })}>
  {loading ? "Loading..." : "Pay €49.99"}
</button>
```

## API

### `Arcora.init(options)`

| Option | Type | Required |
|--------|------|----------|
| `apiKey` | `string` | yes |
| `environment` | `"testnet" \| "mainnet"` | no, defaults to `testnet` |
| `baseUrl` | `string` | no, override per environment |

### `Arcora.createInvoice(params)` → `Promise<{ invoiceId, url }>`

| Param | Type | Required |
|-------|------|----------|
| `amountUsdc` | `number` | yes — USD-equivalent amount, e.g. `49.99` |
| `payInToken` | `"USDC" \| "EURC"` | yes |
| `successUrl` | `string` | yes — http(s) URL |
| `cancelUrl` | `string` | no |
| `metadata` | `Record<string, string>` | no |

Works with either a publishable (`pk_live_`) or secret (`ak_live_`) key. From
the browser, always use the publishable key.

Throws `ArcoraError` on failure with discriminated `code`:
- `INVALID_API_KEY` — 401 from server
- `SERVER_ERROR` — 5xx (includes `retryAfter` if Retry-After header set)
- `NETWORK` — fetch failed
- `INVALID_URL` — non-http(s) successUrl/cancelUrl
- `PUBLISHABLE_KEY_FORBIDDEN` — a publishable key was used on a server-only call (e.g. `escrows()`)
- `TIMEOUT`, `UNKNOWN`

### `Arcora.escrows()` → `Promise<{ pending, matured, claimed }>`

Lists escrow state for the merchant. **Server-side only — requires your secret
`ak_live_` key.** Calling it with a publishable key throws
`PUBLISHABLE_KEY_FORBIDDEN` without making a request.

### `Arcora.openCheckout(invoice)`

Redirects browser to `invoice.url`. Throws if not in a browser environment.

## Error handling

```ts
import { Arcora, ArcoraError } from "@arcora/sdk";

try {
  await Arcora.createInvoice({ ... });
} catch (e) {
  if (e instanceof ArcoraError) {
    if (e.code === "INVALID_API_KEY") /* ... */;
    if (e.code === "SERVER_ERROR" && e.retryAfter) /* ... */;
  }
}
```

## Live demo

[arcorapay.xyz](https://arcorapay.xyz) — pay in USDC or EURC on Arc testnet. Get test EURC from [faucet.circle.com](https://faucet.circle.com) (select Arc Testnet).

## Bundle

| File | Size |
|------|------|
| ESM (`dist/index.mjs`) | ~1.5 KB minified |
| CJS (`dist/index.js`) | ~1.5 KB minified |
| Types (`dist/index.d.ts`) | included |

Zero runtime dependencies. Tree-shake-safe (`sideEffects: false`).

## Source

[github.com/arcoralabs/arcorapay](https://github.com/arcoralabs/arcorapay) — `packages/sdk/`

## License

MIT.
