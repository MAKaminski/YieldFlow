# YieldFlow Agent (desktop)

The local companion that turns a campaign into an assisted, pre-filled sign-up —
running on **your own machine, in your own browser, with you present**. It
pre-fills and navigates (like a supercharged password manager); it does **not**
disguise a bot, spoof fingerprints, or evade bank security. You complete identity
verification, CAPTCHA, and the final submit.

## Quickstart — no Tauri, no Rust, no browser download

Prereqs: **Node 18+** and **Google Chrome** installed. That's it.

```bash
# main is EMPTY until the PR merges — clone the feature branch
git clone -b claude/deposit-bonus-harvesting-agent-3fho6a https://github.com/MAKaminski/YieldFlow
cd YieldFlow/agent
npm install                                   # installs playwright-core only (light)

# set your autofill data locally (never sent to the cloud)
mkdir -p ~/.yieldflow
cp vault.example.json ~/.yieldflow/vault.json # then edit it

# test the handoff without opening a browser (paste the FULL campaign URL):
node run.mjs https://<your-domain>/campaigns/THE_CAMPAIGN_ID --dry-run

# for real (opens your Chrome, pre-fills, pauses for you to finish):
node run.mjs https://<your-domain>/campaigns/THE_CAMPAIGN_ID
```

Every campaign page in the web app has a **"Run it now"** block with the command
already filled in — copy-paste it. The argument can be a bare id, a
`yieldflow://campaign/<id>` link, or a full `https://…/campaigns/<id>` URL; if
you pass a full URL the agent uses its origin as the base automatically (no
`YIELDFLOW_BASE` needed). Otherwise set `--base <url>` or `YIELDFLOW_BASE`.
Get the campaign id from the URL after you click **Start campaign** — no `< >`.

### Recommended: run YieldFlow locally, point the agent at localhost

The simplest, friction-free path — a local app has **no login wall**, so the
agent reaches its job endpoint directly:

```bash
# from the repo root (one directory up from agent/)
npm install
npm run db:reset          # builds local.db + demo data
# npm run db:discover     # optional: pull in the wider offer set
npm run dev               # serves http://localhost:3000
```

Open http://localhost:3000, click an offer → **Start campaign**, then from
`agent/`:

```bash
node run.mjs http://localhost:3000/campaigns/<REAL_ID> --dry-run   # test the handoff
node run.mjs http://localhost:3000/campaigns/<REAL_ID>             # for real (opens Chrome)
```

> **Using a `https://…vercel.app` preview instead?** Vercel **Deployment
> Protection** serves a login page to the agent, so the job fetch gets HTML, not
> JSON. Either turn protection off for the deployment, pass a bypass token
> (`--bypass <token>` or `YIELDFLOW_BYPASS`), or just use localhost as above. If
> the agent hits the wall it now tells you exactly this instead of a raw error.

## What it does

1. Fetches the job from `GET /api/agent/job/<id>` — offer URL, steps, and the
   *keys* of fields to fill. **No SSN/identity ever comes from the cloud.**
2. Merges autofill values from your **local vault** (`~/.yieldflow/vault.json`).
3. Opens your **real Chrome** (`channel: "chrome"`, visible), navigates to the
   application, and pre-fills matching non-identity fields.
4. **Pauses for you** to do identity verification, any promo code, CAPTCHA, and
   submit. Reports progress to `POST /api/agent/progress` (the web app shows it).
5. If a bank blocks the automated browser, it leaves the page open with the
   values ready to paste — no evasion.

## Layout

```
agent/
├── run.mjs             the CLI (Playwright driver) — this is the whole agent
├── package.json
├── vault.example.json  copy to ~/.yieldflow/vault.json
└── desktop/            OPTIONAL Tauri wrapper (the signed .exe + yieldflow:// launch)
    ├── src-tauri/
    └── ui/
```

## Optional: package into a signed .exe with the one-click link

Only needed if you want the **Launch agent** button to open the app directly via
`yieldflow://`. This uses the Tauri project in `desktop/` and requires Rust + the
[Tauri v2 prerequisites](https://v2.tauri.app/start/prerequisites/):

```bash
# 1. package the CLI into a platform binary Tauri can bundle
npm run build:bin        # -> desktop/src-tauri/binaries/yieldflow-sidecar

# 2. build the installer
cd desktop/src-tauri
cargo tauri build        # -> Windows .exe (NSIS) / macOS .dmg / Linux AppImage
```

**Code signing** is required for a non-scary install: an EV/OV cert on Windows
(SmartScreen), an Apple Developer ID + notarization on macOS. Tauri's bundler
supports both — see the Tauri distribution docs. Then host the installers and
point the web app's `/download` page at them.

## Boundaries (unchanged)

- Runs on your device, in a real session — no stealth, no fingerprint spoofing,
  no CAPTCHA solving.
- Pre-fills non-identity fields only; you do identity verification + submit.
- Never moves money or takes custody of funds.
