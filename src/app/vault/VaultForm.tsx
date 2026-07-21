"use client";

import { useState } from "react";

// Fields the agent pre-fills, plus the identity fields the user completes. This
// form runs entirely in the browser: it builds a vault.json and downloads it to
// the user's machine. Nothing — especially SSN/DOB — is ever sent to a server.
const FIELDS: { key: string; label: string; identity?: boolean; placeholder?: string }[] = [
  { key: "firstName", label: "First name" },
  { key: "middleName", label: "Middle name (optional)" },
  { key: "lastName", label: "Last name" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Phone", placeholder: "digits only" },
  { key: "addressLine1", label: "Street address" },
  { key: "addressLine2", label: "Apt / Suite (optional)" },
  { key: "city", label: "City" },
  { key: "state", label: "State", placeholder: "2-letter, e.g. GA" },
  { key: "zip", label: "ZIP" },
  { key: "dateOfBirth", label: "Date of birth", identity: true, placeholder: "MM/DD/YYYY" },
  { key: "ssn", label: "SSN", identity: true, placeholder: "stays in your browser" },
];

export function VaultForm() {
  const [values, setValues] = useState<Record<string, string>>({});
  const [done, setDone] = useState(false);

  const set = (k: string, v: string) => {
    setValues((prev) => ({ ...prev, [k]: v }));
    setDone(false);
  };

  const download = () => {
    // Build the vault entirely client-side; only non-empty fields are included.
    const out: Record<string, string> = {};
    for (const { key } of FIELDS) {
      const v = (values[key] ?? "").trim();
      if (v) out[key] = v;
    }
    const blob = new Blob([JSON.stringify(out, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "vault.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setDone(true);
  };

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {FIELDS.map((f) => (
          <label key={f.key} className="text-sm">
            <span className="mb-1 flex items-center gap-2 text-mute">
              {f.label}
              {f.identity && (
                <span className="rounded bg-warn/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-warn">
                  stays on your device
                </span>
              )}
            </span>
            <input
              value={values[f.key] ?? ""}
              onChange={(e) => set(f.key, e.target.value)}
              placeholder={f.placeholder}
              autoComplete="off"
              className="w-full rounded-lg border border-edge/70 bg-ink/50 px-3 py-2 text-slate-100 outline-none focus:border-accent/60"
            />
          </label>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={download}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-ink hover:bg-accent/90"
        >
          Download vault.json ↓
        </button>
        {done && <span className="text-xs text-accent">Downloaded ✓ — now move it into place (below).</span>}
      </div>

      <div className="rounded-lg border border-edge/60 bg-panel/40 p-3 text-xs text-mute">
        <p className="mb-1 font-medium text-slate-200">Where it goes</p>
        <p>
          Move the downloaded file to <code className="text-accent">~/.yieldflow/vault.json</code>:
        </p>
        <pre className="mt-2 overflow-x-auto rounded border border-edge/60 bg-ink/50 p-2 text-[11px]">
{`mkdir -p ~/.yieldflow
mv ~/Downloads/vault.json ~/.yieldflow/vault.json
chmod 600 ~/.yieldflow/vault.json`}
        </pre>
        <p className="mt-2">
          Prefer the terminal? <code className="text-accent">node run.mjs --setup</code> asks for the
          same fields and writes this file for you.
        </p>
      </div>
    </div>
  );
}
