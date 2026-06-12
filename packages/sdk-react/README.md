# @arcora/sdk-react

React bindings for [`@arcora/sdk`](https://www.npmjs.com/package/@arcora/sdk) — drop-in `<CheckoutButton />` and `useCheckout()` hook for Arcora stablecoin payments on Arc Network.

## Install

```bash
npm install @arcora/sdk-react @arcora/sdk
# or
pnpm add @arcora/sdk-react @arcora/sdk
```

`@arcora/sdk` is a peer dependency.

> **Use your publishable key here.** These components run in the browser, so
> pass your **publishable** key (`pk_live_…`) — it is safe to embed in client
> code. Never put your **secret** key (`ak_live_…`) in a React component or any
> browser-shipped code; keep it on your server. Configure your allowed origins
> in the dashboard so publishable-key checkouts are accepted.

## Quick start

```tsx
import { CheckoutButton } from "@arcora/sdk-react";

export function Checkout() {
  return (
    <CheckoutButton
      apiKey="pk_live_..." /* publishable key — safe in the browser */
      environment="testnet"
      invoice={{
        amountUsdc: 49.99,
        payInToken: "EURC",
        successUrl: "https://my-store.com/success",
      }}
    >
      Pay €49.99
    </CheckoutButton>
  );
}
```

## Hook

For more control, use `useCheckout`:

```tsx
import { useCheckout } from "@arcora/sdk-react";

function Pay() {
  const { checkout, loading, error } = useCheckout({
    apiKey: "pk_live_...", // publishable key — safe in the browser
    environment: "testnet",
  });

  return (
    <>
      <button onClick={() => checkout({
        amountUsdc: 49.99,
        payInToken: "EURC",
        successUrl: window.location.origin + "/success",
      })} disabled={loading}>
        {loading ? "Loading..." : "Pay €49.99"}
      </button>
      {error && <p>{error.message}</p>}
    </>
  );
}
```

## Props / hook options

`<CheckoutButton />` accepts every option `Arcora.init` accepts (`apiKey`, `environment`, `baseUrl`) plus an `invoice` object matching `Arcora.createInvoice` params, plus standard React `children` and `className`.

`useCheckout(initOpts)` returns `{ checkout, loading, error }`. `checkout(invoice)` calls `Arcora.createInvoice` then `Arcora.openCheckout` (browser redirect). `error` is an `ArcoraError` instance.

## Source

[github.com/arcoralabs/arcorapay](https://github.com/arcoralabs/arcorapay) — `packages/sdk-react/`

## License

MIT.
