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

Then drive the whole loop from `agent/` — no browser needed. The base defaults
to `http://localhost:3000`, so these Just Work locally:

```bash
node run.mjs --setup                  # enter your details once → writes the local vault
node run.mjs                          # interactive menu: ↑/↓ to pick an offer, Enter to start it
node run.mjs --offers                 # list offers (marks which open in a browser)
node run.mjs --start <offerId>        # start a campaign → prints its id + run command
node run.mjs --list                   # list campaigns you can run
node run.mjs http://localhost:3000/campaigns/<id>           # opens Chrome, drives the form
node run.mjs http://localhost:3000/campaigns/<id> --auto    # same, but auto-answers the prompts
node run.mjs http://localhost:3000/campaigns/<id> --dry-run # just test the handoff, no browser
```

**`--setup`** prompts you for every field (name, DOB, SSN, address…) and writes
`~/.yieldflow/vault.json` on your machine — nothing is sent to us. **`--auto`**
answers the step prompts for you (takes the default CTA, and *declines* add-ons
like a bundled savings account); it still stops at the identity step and never
submits — review the browser before you finish.

The easiest path is just **`node run.mjs`** with no arguments: it shows an
arrow-key menu of offers, and pressing Enter starts that campaign and offers to
open it in Chrome right away.

`--offers` flags each offer `web ✓` (the agent can drive it) or `… (manual)`
(app-only / no web form — you open it yourself). Pick a `web ✓` offer to see the
browser open and pre-fill. You can also start a campaign in the browser and copy
its id from the URL — same thing.

> The commands hit `http://localhost:3000` by default. Point them at a deploy
> with `--base <url>` or `YIELDFLOW_BASE` (a protected `vercel.app` preview also
> needs `--bypass <token>` / `YIELDFLOW_BYPASS`, or just use localhost).

> **Using a `https://…vercel.app` preview instead?** Vercel **Deployment
> Protection** serves a login page to the agent, so the job fetch gets HTML, not
> JSON. Either turn protection off for the deployment, pass a bypass token
> (`--bypass <token>` or `YIELDFLOW_BYPASS`), or just use localhost as above. If
> the agent hits the wall it now tells you exactly this instead of a raw error.

## Every run is recorded (so issues are diagnosable)

Each run writes a diagnostics folder to **`~/.yieldflow/runs/<timestamp>/`**:

- `run.log` — a timestamped step log (base, offer, each page it loaded with the
  resulting URL + title, bot-wall/error detection, which fields it filled, and
  the final outcome). It records field **names** and page labels only — **never
  your vault values**.
- `01-loaded.png`, `02-prefilled.png`, `error.png` — screenshots at each stage.
- a `.webm` **video** of the browser session.

If something goes wrong, send the folder's `run.log` + the `.png` files and it's
easy to see exactly where it stopped. Add **`--debug`** to also stream the log to
the console. Note: screenshots/video can show pre-filled name/address/email (no
SSN — the agent never enters that), so review before sharing.

## What it does

1. Fetches the job from `GET /api/agent/job/<id>` — offer URL, steps, and the
   *keys* of fields to fill. **No SSN/identity ever comes from the cloud.**
2. Merges autofill values from your **local vault** (`~/.yieldflow/vault.json`).
3. Opens your **real Chrome** (`channel: "chrome"`, visible), navigates to the
   application, and pre-fills matching fields. **DOB/SSN are filled too — but
   only if you put them in your local vault** (opt-in; they never come from the
   cloud). Even then the agent **stops** at the identity step for you to review,
   clear any CAPTCHA/ID check, and submit.
4. **Guides the application forward.** Bank "apply" links often land on a
   marketing page whose real form is a click away (a ZIP modal, an "Open an
   account" button…). After pre-filling, the agent lists the candidate
   next-step buttons and lets you **pick which one to click** (`[Enter]=1 · type
   1-N · s = I'll click it · q = stop`) — so on a busy page with several
   look-alike CTAs you choose the right one (e.g. "OPEN NOW"). If a popup/modal
   is open (ZIP/location gate), it offers that popup's confirm button first. When
   a step needs a **choice** (e.g. radio buttons — "bundle a savings account?"),
   it lists the options and lets you pick, then selects it so the step's Continue
   works. If a click doesn't advance the page, it stops and hands over rather than
   looping. It advances **page by page**, re-filling each, until the
   **identity/KYC step (SSN/DOB), where it always stops.** If you saved DOB/SSN in
   the vault it pre-fills them there first, but it never clicks submit, e-sign, or
   identity actions — you review and finish.
5. **Pauses for you** to do identity verification, any promo code, CAPTCHA, and
   submit. Reports progress to `POST /api/agent/progress` (the web app shows it).
6. If a bank blocks the automated browser, it leaves the page open with the
   values ready to paste — no evasion.

## Layout

```
agent/
├── run.mjs             the CLI (Playwright driver) — this is the whole agent
├── package.json
├── vault.example.json  copy to ~/.yieldflow/vault.json
├── test/               automated tests for the click-through engine
│   ├── drive.test.mjs  runs driveSteps against fake bank flows, headless
│   └── fixtures/*.html faithful single-URL SPA wizards (BMO gate, stuck, stale)
└── desktop/            OPTIONAL Tauri wrapper (the signed .exe + yieldflow:// launch)
    ├── src-tauri/
    └── ui/
```

## Tests

The click-through engine (`driveSteps`) is covered by an automated harness that
runs the **real** logic against faithful fake bank-flow fixtures in headless
Chromium — verifying the ZIP/location gate, choosing the right CTA among decoys,
required radio choices, prefill, the **identity stop**, stale re-renders, and the
no-progress handover, all without a real bank site.

```bash
npm test        # needs a Chromium binary
# point PW_CHROMIUM at one if the default path isn't present:
# npx playwright install chromium   (then set PW_CHROMIUM to its path)
```

This proves the agent's *logic*; real-bank DOM quirks + KYC still need a real
browser (that's the part you drive).

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
