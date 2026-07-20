"use client";

import { useState } from "react";

// Small copy-to-clipboard chip for exact values (promo code, DD amount) so the
// user can paste them into the bank's form without transcription errors.
export function CopyChip({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard blocked — no-op */
        }
      }}
      className="inline-flex items-center gap-1.5 rounded border border-edge/70 bg-ink/40 px-2 py-1 text-xs hover:border-accent/60"
      title={`Copy ${label}`}
    >
      <span className="text-mute">{label}:</span>
      <span className="font-mono text-slate-100">{value}</span>
      <span className={copied ? "text-accent" : "text-mute"}>{copied ? "✓" : "⧉"}</span>
    </button>
  );
}
