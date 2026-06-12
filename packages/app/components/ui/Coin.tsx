/**
 * Small circular token glyph (USDC, EURC, …) styled via the `.coin` /
 * `.coin--*` recipes in globals.css. Unknown symbols fall back to the
 * USDC palette with the symbol's first letter.
 */
export function Coin({ sym }: { sym: string }) {
  const cls: Record<string, string> = {
    USDC: "coin--usdc", EURC: "coin--eurc", USDT: "coin--usdt", DAI: "coin--dai", PYUSD: "coin--pyusd",
  };
  const label: Record<string, string> = { USDC: "$", EURC: "€", USDT: "₮", DAI: "◈", PYUSD: "P" };
  return (
    <span className={`coin ${cls[sym] ?? "coin--usdc"}`} aria-hidden="true">
      {label[sym] ?? sym.slice(0, 1)}
    </span>
  );
}
