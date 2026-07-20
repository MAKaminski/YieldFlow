# YieldFlow Agent (desktop)

The local companion that turns a campaign into an assisted, pre-filled sign-up —
running on the **user's own machine, in their own browser, with them present**.
This is the legitimate form of "agentic sign-up": it pre-fills and navigates
(like a supercharged password manager); it does **not** disguise a bot, spoof
fingerprints, or evade bank security. The user completes identity verification,
CAPTCHA, and the final submit.

## How it fits together

```
YieldFlow web app (cloud)                     User's machine
─────────────────────────                     ─────────────
[Launch agent] button
   → opens yieldflow://campaign/<id>  ───────▶ Tauri shell (src-tauri/)
                                                  │ extracts <id>, runs sidecar
GET /api/agent/job/<id>  ◀───────────────────── sidecar (sidecar/run.mjs)
   (offer URL, steps, field keys — no PII)        │ fetches job
                                                  │ loads local vault (~/.yieldflow/vault.json)
                                                  │ opens the user's real Chrome (headed)
                                                  │ navigates + pre-fills non-identity fields
POST /api/agent/progress  ◀───────────────────── │ reports progress (web app shows it live)
                                                  ▼ PAUSES for the user to do KYC + submit
```

- **No sensitive data leaves the machine.** The cloud job contains only the
  offer URL, steps, and the *keys* of fields to fill. Values (name/address, and
  any identity data) live in the local vault and are merged in on-device.
- **Graceful fallback.** If a bank blocks even a real headed browser, the agent
  reports `blocked` and leaves the page open with the values ready to paste.

## Layout

```
agent/
├── sidecar/           Node + Playwright driver (the automation logic)
│   ├── run.mjs
│   └── package.json
├── src-tauri/         Tauri v2 shell (deep-link registration + spawns sidecar)
│   ├── src/main.rs
│   ├── Cargo.toml
│   ├── build.rs
│   └── tauri.conf.json
├── ui/                minimal window UI
└── vault.example.json copy to ~/.yieldflow/vault.json
```

## Build & run (on a real desktop — not producible in CI here)

Prereqs: Rust + Cargo, Node 18+, the [Tauri v2 prerequisites](https://v2.tauri.app/start/prerequisites/),
and Google Chrome installed (the sidecar drives your real Chrome).

```bash
# 1. Set the vault (never leaves your machine)
mkdir -p ~/.yieldflow && cp agent/vault.example.json ~/.yieldflow/vault.json  # then edit

# 2. Package the Playwright sidecar into a platform binary Tauri can bundle
cd agent/sidecar && npm install && npm run build:bin

# 3. Point the agent at your deployment, then build the app
cd ../src-tauri
export YIELDFLOW_BASE="https://<your-yieldflow-domain>"
cargo tauri dev            # run locally
cargo tauri build          # -> Windows .exe (NSIS), macOS .dmg, Linux AppImage
```

Test the sidecar alone (opens Chrome, pre-fills, waits for you):

```bash
cd agent/sidecar
YIELDFLOW_BASE="https://<your-domain>" node run.mjs <campaignId>
```

## Shipping a real installer

- **Code signing is required** for a non-scary install: an EV/OV cert on Windows
  (SmartScreen) and an Apple Developer ID + notarization on macOS. Tauri's
  bundler supports both — see the Tauri distribution docs. (This repo can't
  produce a signed binary; do it on a signing-capable build box / CI.)
- Host the installers and point the web app's `/download` page at them.

## Boundaries (unchanged from the product's posture)

- Runs on the user's device, in a real session — no stealth, no fingerprint
  spoofing, no CAPTCHA solving.
- Pre-fills non-identity fields only; the user does identity verification + submit.
- Never moves money or takes custody of funds.
