"use client";

import { useState, useEffect } from "react";

interface ExpiryCountdownProps {
  expiresAt: Date;
  className?: string;
}

function formatRemaining(diff: number): string {
  if (diff <= 0) return "Expired";
  const mins = Math.floor(diff / 60000);
  const secs = Math.floor((diff % 60000) / 1000);
  if (mins > 0) return `Expires in ${mins}m ${secs}s`;
  return `Expires in ${secs}s`;
}

export function ExpiryCountdown({ expiresAt, className }: ExpiryCountdownProps) {
  const [label, setLabel] = useState("…");

  useEffect(() => {
    if (expiresAt.getTime() <= Date.now()) { setLabel("Expired"); return; }
    const tick = () => setLabel(formatRemaining(expiresAt.getTime() - Date.now()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiresAt]);

  return (
    <span
      className={className}
      role="timer"
      aria-atomic="true"
      aria-live={label === "Expired" ? "assertive" : "polite"}
    >
      {label}
    </span>
  );
}
