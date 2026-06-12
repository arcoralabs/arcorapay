"use client";

import { useState } from "react";

export interface ShippingAddress {
  email:      string;
  fullName:   string;
  line1:      string;
  line2?:     string;
  city:       string;
  postalCode: string;
  country:    string;
}

interface Props {
  value:    ShippingAddress;
  onChange: (next: ShippingAddress) => void;
}

const COUNTRIES = [
  "United States", "United Kingdom", "Germany", "France", "Netherlands",
  "Italy", "Spain", "Türkiye", "Switzerland", "Sweden", "Norway", "Denmark",
  "Canada", "Australia", "Japan", "Singapore", "Other",
];

export function AddressForm({ value, onChange }: Props) {
  const set = (k: keyof ShippingAddress) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    onChange({ ...value, [k]: e.target.value });

  return (
    <div className="space-y-4">
      <Field label="Email" hint="Order confirmation goes here.">
        <input type="email" required value={value.email} onChange={set("email")} className={inputCls} placeholder="you@example.com" />
      </Field>
      <Field label="Full name">
        <input type="text" required value={value.fullName} onChange={set("fullName")} className={inputCls} />
      </Field>
      <Field label="Address line 1">
        <input type="text" required value={value.line1} onChange={set("line1")} className={inputCls} />
      </Field>
      <Field label="Address line 2" optional>
        <input type="text" value={value.line2 ?? ""} onChange={set("line2")} className={inputCls} />
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="City"><input type="text" required value={value.city} onChange={set("city")} className={inputCls} /></Field>
        <Field label="Postal code"><input type="text" required value={value.postalCode} onChange={set("postalCode")} className={inputCls} /></Field>
      </div>
      <Field label="Country">
        <select required value={value.country} onChange={set("country")} className={inputCls}>
          <option value="">Select…</option>
          {COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </Field>
    </div>
  );
}

const inputCls =
  "w-full h-11 px-3 rounded-lg border border-arcora-border bg-white focus:outline-none focus:ring-2 focus:ring-arcora-blue/40 focus:border-arcora-blue transition-colors";

function Field({ label, hint, optional, children }: { label: string; hint?: string; optional?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs uppercase tracking-wider font-semibold text-arcora-muted-fg mb-1.5">
        {label} {optional && <span className="font-normal lowercase">(optional)</span>}
      </span>
      {children}
      {hint && <span className="block text-xs text-arcora-muted-fg mt-1">{hint}</span>}
    </label>
  );
}
