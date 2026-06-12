"use client";

import { createContext, useContext, useEffect, useState, useCallback, useMemo } from "react";
import { z } from "zod";

export interface CartItem {
  sku:     string;          // product slug
  name:    string;
  price:   number;
  image:   string;
  qty:     number;
  size?:   string;
}

interface CartState {
  items:    CartItem[];
  subtotal: number;
  count:    number;
  add:      (item: Omit<CartItem, "qty">, qty?: number) => void;
  setQty:   (key: string, qty: number) => void;
  remove:   (key: string) => void;
  clear:    () => void;
  keyOf:    (item: { sku: string; size?: string }) => string;
}

const STORAGE_KEY = "arcora-shop-cart-v1";
const Ctx = createContext<CartState | null>(null);

/**
 * Audit L10 (2026-05-06): validate cart data from localStorage with Zod to
 * prevent prototype-pollution or malformed-data attacks via injected storage.
 * Falls back to [] on parse failure — same silent-fail semantics as before.
 */
const cartItemSchema = z.object({
  sku:   z.string(),
  name:  z.string(),
  price: z.number().finite().nonnegative(),
  image: z.string(),
  qty:   z.number().int().positive(),
  size:  z.string().optional(),
});
const cartSchema = z.array(cartItemSchema);

function keyOf(item: { sku: string; size?: string }): string {
  return `${item.sku}::${item.size ?? ""}`;
}

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      const parsed = cartSchema.safeParse(JSON.parse(raw ?? "[]"));
      setItems(parsed.success ? parsed.data : []);
    } catch { /* corrupt storage or JSON.parse error — start fresh */ }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  }, [items, hydrated]);

  const add = useCallback((item: Omit<CartItem, "qty">, qty = 1) => {
    setItems(prev => {
      const k = keyOf(item);
      const existing = prev.find(p => keyOf(p) === k);
      if (existing) {
        return prev.map(p => keyOf(p) === k ? { ...p, qty: p.qty + qty } : p);
      }
      return [...prev, { ...item, qty }];
    });
  }, []);

  const setQty = useCallback((key: string, qty: number) => {
    setItems(prev =>
      qty <= 0
        ? prev.filter(p => keyOf(p) !== key)
        : prev.map(p => keyOf(p) === key ? { ...p, qty } : p),
    );
  }, []);

  const remove = useCallback((key: string) => {
    setItems(prev => prev.filter(p => keyOf(p) !== key));
  }, []);

  const clear = useCallback(() => setItems([]), []);

  const value = useMemo<CartState>(() => {
    const subtotal = items.reduce((acc, i) => acc + i.price * i.qty, 0);
    const count    = items.reduce((acc, i) => acc + i.qty, 0);
    return { items, subtotal, count, add, setQty, remove, clear, keyOf };
  }, [items, add, setQty, remove, clear]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCart(): CartState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useCart must be inside CartProvider");
  return ctx;
}
