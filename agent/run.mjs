#!/usr/bin/env node
// YieldFlow desktop agent (CLI).
//
// Runs on the USER's machine. Given a campaign id, it fetches the job from the
// cloud, opens the bank application in the user's REAL Chrome, pre-fills the
// non-identity fields from a local vault, then PAUSES for the user to complete
// identity verification, CAPTCHA, and submit. It reports progress back.
//
// It does NOT impersonate, spoof, or evade detection: a real human is present
// and completes every human/identity step. If a bank blocks even this, it leaves
// the page open with the values ready to paste (graceful fallback).
//
// Quickstart (no Tauri, no Rust, no browser download — just Node 18+ and Chrome):
//   YIELDFLOW_BASE="https://your-yieldflow-domain" node run.mjs <campaignId>
//
// Commands:
//   node run.mjs                     interactive menu — arrow-key pick an offer
//   node run.mjs --setup             enter your details → writes the local vault
//   node run.mjs --offers            list offers you can start a campaign for
//   node run.mjs --start <offerId>   start a campaign, print its id + run command
//   node run.mjs --list              list campaigns you can run
//   node run.mjs <campaignId|URL>    run the agent (id, yieldflow://campaign/<id>,
//                                    or a full https://…/campaigns/<id> URL)
//
// Flags:
//   --base <url>   base URL (or YIELDFLOW_BASE); defaults to http://localhost:3000
//   --auto         answer the step prompts automatically (defaults; declines add-ons)
//   --dry-run      fetch the job and print the plan, but DON'T open a browser
//   --debug        mirror the run log to the console (verbose)
//   --bypass <t>   Vercel protection-bypass token (or set YIELDFLOW_BYPASS) —
//                  only needed against a protected preview URL; running the app
//                  locally at http://localhost:3000 avoids the auth wall entirely
//   env YIELDFLOW_VAULT   path to the vault (default ~/.yieldflow/vault.json)
//
// Every run writes a diagnostics folder to ~/.yieldflow/runs/<timestamp>/
// (run.log + screenshots + a browser video). Share run.log + the .png files to
// get help — it records field KEYS and page labels, never your vault values.

import { readFileSync, writeFileSync, mkdirSync, appendFileSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import readline from "node:readline";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const debug = args.includes("--debug");
const auto = args.includes("--auto");
const baseFlagIdx = args.indexOf("--base");
const baseArg = baseFlagIdx >= 0 ? args[baseFlagIdx + 1] : undefined;
const bypassFlagIdx = args.indexOf("--bypass");
const bypassArg = bypassFlagIdx >= 0 ? args[bypassFlagIdx + 1] : undefined;
const BYPASS = bypassArg ?? process.env.YIELDFLOW_BYPASS;

// Subcommands make the CLI a self-contained menu (no browser needed):
//   --offers            list offers you can start a campaign for
//   --start <offerId>   start a campaign, print its id + the run command
//   --list              list campaigns you can run
const listOffers = args.includes("--offers");
const listCampaigns = args.includes("--list");
const wantSetup = args.includes("--setup");
const startIdx = args.indexOf("--start");
const startOfferId = startIdx >= 0 ? args[startIdx + 1] : undefined;
const SUBCOMMAND = wantSetup
  ? "setup"
  : listOffers
    ? "offers"
    : listCampaigns
      ? "list"
      : startIdx >= 0
        ? "start"
        : null;

const positional = args.find(
  (a) => !a.startsWith("--") && a !== baseArg && a !== bypassArg && a !== startOfferId,
);

// Only needed when hitting a Vercel preview that has Deployment Protection on;
// harmless (and unused) against localhost.
const authHeaders = BYPASS
  ? {
      "x-vercel-protection-bypass": BYPASS,
      "x-vercel-set-bypass-cookie": "true",
    }
  : {};

/** True when a response body is an HTML page (login wall, 404 page) not JSON. */
function looksLikeHtml(body) {
  return /^\s*<(?:!doctype|html)/i.test(body);
}

/** Guidance shown when an endpoint returns HTML (auth wall / wrong id) not JSON. */
function htmlWallMessage() {
  return [
    "\nThe endpoint returned a web page, not JSON.",
    "",
    "Most likely one of:",
    `  • ${BASE} is a Vercel preview with Deployment Protection (SSO) on —`,
    "    run YieldFlow locally and point the agent at http://localhost:3000,",
    "    or turn the protection off / pass --bypass <token> (YIELDFLOW_BYPASS).",
    "  • the id in the URL is wrong — use a real id from `--offers` / `--list`,",
    "    not a placeholder like THE_ID.",
    "",
    "List what's available:",
    "  node run.mjs --offers      # offers you can start",
    "  node run.mjs --list        # campaigns you can run",
  ].join("\n");
}

/** Fetch JSON from BASE with the auth headers + a clear HTML/auth-wall guard. */
async function fetchJson(path, init) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { ...(init?.headers ?? {}), ...authHeaders },
  });
  const body = await res.text();
  let data;
  try {
    data = JSON.parse(body);
  } catch {
    if (looksLikeHtml(body)) {
      console.error(htmlWallMessage());
      process.exit(1);
    }
    throw new Error(`response wasn't JSON (${BASE}${path}): ${body.slice(0, 200)}`);
  }
  if (!res.ok) {
    throw new Error(data?.error ?? `HTTP ${res.status} (${BASE}${path})`);
  }
  return data;
}

// ── Pretty output ─────────────────────────────────────────────────────────────
// ANSI helpers, no-ops when stdout isn't a TTY (so piping stays clean/scriptable).
const COLOR = process.stdout.isTTY;
const paint = (code, s) => (COLOR ? `\x1b[${code}m${s}\x1b[0m` : `${s}`);
const green = (s) => paint("32", s);
const yellow = (s) => paint("33", s);
const cyan = (s) => paint("36", s);
const dim = (s) => paint("2", s);
const bold = (s) => paint("1", s);
const inverse = (s) => paint("7", s);

/** Channel/verification badge: verified web ✓ · unverified web ⚠ · manual. */
function offerBadge(o) {
  if (o.applicationChannel === "web" && o.applicationUrl) {
    return o.applicationUrlVerified ? green("web ✓") : yellow("web ⚠ unverified");
  }
  return dim(`${o.applicationChannel ?? "?"} (manual)`);
}

function offerBonus(o) {
  return o.bonusAmountCents
    ? `$${(o.bonusAmountCents / 100).toFixed(0)}`
    : o.bonusApyBps
      ? `${(o.bonusApyBps / 100).toFixed(2)}% APY`
      : "—";
}

/** Fit a string to width `w`: pad with spaces, or truncate with an ellipsis. */
function fit(s, w) {
  if (s.length <= w) return s + " ".repeat(w - s.length);
  return s.slice(0, Math.max(0, w - 1)) + "…";
}

/**
 * Build aligned rows for a list of offers. Returns { header, rows } where each
 * row is { text, o } — `text` has no leading marker (the picker adds ❯ / space).
 */
function offersTable(offers) {
  // Reserve 4 cols: 2 for the picker's "❯ " marker + 2 safety, so a row never
  // wraps (wrapping corrupts the in-place redraw). Reserve 18 for the widest
  // badge ("web ⚠ unverified").
  const cols = Math.max(60, (process.stdout.columns || 100) - 4);
  const bonusW = Math.max(...offers.map((o) => offerBonus(o).length), 5);
  const badgeW = 18;
  const nameW = Math.max(24, cols - 3 - 2 - bonusW - 2 - badgeW);
  const rows = offers.map((o, i) => {
    const idx = String(i + 1).padStart(2);
    const name = fit(`${o.institution} — ${o.title}`, nameW);
    const bonus = offerBonus(o).padStart(bonusW);
    return { o, text: `${dim(idx)}  ${name}  ${cyan(bonus)}  ${offerBadge(o)}` };
  });
  return { rows, nameW, bonusW };
}

/**
 * Interactive arrow-key picker over offers. ↑/↓ or k/j to move, Enter to select,
 * q/Esc/Ctrl-C to cancel. Resolves to the chosen offer, or null if cancelled.
 * Falls back to null immediately if stdin isn't a TTY (caller handles that).
 */
function pickOffer(offers) {
  if (!process.stdin.isTTY) return Promise.resolve(null);
  const { rows } = offersTable(offers);
  let sel = 0;
  const n = rows.length;

  const draw = (first) => {
    if (!first) process.stdout.write(`\x1b[${n}A`); // cursor up n lines
    for (let i = 0; i < n; i++) {
      const marker = i === sel ? bold(green("❯ ")) : "  ";
      const line = i === sel ? inverse(rows[i].text) : rows[i].text;
      process.stdout.write(`\x1b[2K${marker}${line}\n`); // clear line + write
    }
  };

  process.stdout.write(
    bold(`\nPick an offer  `) + dim("(↑/↓ move · Enter select · q cancel)\n\n"),
  );
  draw(true);

  return new Promise((resolve) => {
    readline.emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    const cleanup = () => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.removeListener("keypress", onKey);
    };
    const onKey = (str, key) => {
      if (!key) return;
      if (key.name === "up" || key.name === "k") sel = (sel - 1 + n) % n;
      else if (key.name === "down" || key.name === "j") sel = (sel + 1) % n;
      else if (key.name === "return" || key.name === "enter") {
        cleanup();
        process.stdout.write("\n");
        return resolve(rows[sel].o);
      } else if (key.name === "q" || key.name === "escape" || (key.ctrl && key.name === "c")) {
        cleanup();
        process.stdout.write(dim("\ncancelled\n"));
        return resolve(null);
      } else return;
      draw(false);
    };
    process.stdin.on("keypress", onKey);
  });
}

/** Simple y/N confirm on a TTY (defaults to No). */
function confirm(question) {
  if (!process.stdin.isTTY) return Promise.resolve(false);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${question} ${dim("(y/N)")} `, (a) => {
      rl.close();
      resolve(/^y(es)?$/i.test(a.trim()));
    });
  });
}

// ── Run recorder ──────────────────────────────────────────────────────────────
// Each run writes a diagnostics folder the user can share so issues are visible
// even though the agent runs on their machine, not ours. The log records field
// KEYS + page labels only — never vault values.
function pad2(n) {
  return String(n).padStart(2, "0");
}
function makeRunDir() {
  const d = new Date();
  const stamp =
    `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}` +
    `-${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
  const dir = join(homedir(), ".yieldflow", "runs", stamp);
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    /* fall back to no-dir logging */
  }
  return dir;
}
let RUN_DIR = null;
const LOG_FILE = () => (RUN_DIR ? join(RUN_DIR, "run.log") : null);
function log(line) {
  const stamped = `[${new Date().toISOString()}] ${line}`;
  if (debug) console.log(dim(stamped));
  const f = LOG_FILE();
  if (f) {
    try {
      appendFileSync(f, stamped + "\n");
    } catch {
      /* best-effort */
    }
  }
}
async function snap(page, name) {
  if (!RUN_DIR || !page) return;
  try {
    await page.screenshot({ path: join(RUN_DIR, `${name}.png`) });
    log(`screenshot: ${name}.png`);
  } catch (e) {
    log(`screenshot ${name} failed: ${String(e).slice(0, 120)}`);
  }
}

const VAULT_PATH = process.env.YIELDFLOW_VAULT ?? join(homedir(), ".yieldflow", "vault.json");

/** Accept a bare id, yieldflow://campaign/<id>, or https://…/campaigns/<id>. */
function parseCampaignId(input) {
  if (!input) return undefined;
  const proto = input.match(/^yieldflow:\/\/campaign\/([^/?#]+)/i);
  if (proto) return proto[1];
  const web = input.match(/\/campaigns\/([^/?#]+)/i);
  if (web) return web[1];
  return input.trim();
}

/** If they passed a full https://…/campaigns/<id> URL, use its origin as the base. */
function baseFromInput(input) {
  const m = input?.match(/^(https?:\/\/[^/]+)/i);
  return m ? m[1] : undefined;
}

const BASE =
  baseArg ??
  process.env.YIELDFLOW_BASE ??
  baseFromInput(positional) ??
  "http://localhost:3000";
// No subcommand and no positional, on a real terminal → interactive menu.
const wantInteractive = !SUBCOMMAND && !positional && process.stdin.isTTY;
const campaignId = SUBCOMMAND || wantInteractive ? undefined : parseCampaignId(positional);

function usageAndExit() {
  console.error(
    [
      "usage:",
      "  node run.mjs                                interactive menu (pick an offer)",
      "  node run.mjs --setup                        enter your details (writes the vault)",
      "  node run.mjs --offers                       list offers you can start",
      "  node run.mjs --start <offerId>              start a campaign (prints its id)",
      "  node run.mjs --list                         list campaigns you can run",
      "  node run.mjs <campaignId | https://…/campaigns/ID>   run the agent",
      "",
      "  flags: [--base URL] [--bypass TOKEN] [--auto] [--dry-run]",
      "  base defaults to http://localhost:3000 (set --base / YIELDFLOW_BASE for a deploy)",
    ].join("\n"),
  );
  process.exit(1);
}

let job;
// The campaign currently being run — set by main(); lets the interactive picker
// launch a freshly-started campaign without re-parsing argv.
let activeCampaignId = campaignId;
async function report(status, taskType, note) {
  if (dryRun) return;
  try {
    await fetch(job?.progressUrl ?? `${BASE}/api/agent/progress`, {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeaders },
      body: JSON.stringify({ campaignId: activeCampaignId, taskType, status, note }),
    });
  } catch {
    /* progress is best-effort */
  }
}

function loadVault() {
  try {
    const v = JSON.parse(readFileSync(VAULT_PATH, "utf8"));
    delete v._comment;
    return v;
  } catch {
    console.warn(`No vault at ${VAULT_PATH} — nothing to pre-fill (fine for --dry-run).`);
    return {};
  }
}

// Map a form field (by its label/name/placeholder) to a vault key.
const FIELD_HINTS = {
  firstName: [/first ?name/i, /given name/i, /\bfname\b/i],
  lastName: [/last ?name/i, /surname/i, /\blname\b/i],
  middleName: [/middle ?name/i, /middle ?initial/i, /\bmi\b/i],
  email: [/e-?mail/i],
  phone: [/phone/i, /mobile/i, /\btel\b/i],
  addressLine1: [/address ?line ?1/i, /address ?1/i, /street/i, /^address$/i, /\baddr(ess)?1\b/i, /residential address/i],
  addressLine2: [/address ?line ?2/i, /address ?2/i, /apt|suite|unit/i, /\baddr(ess)?2\b/i],
  city: [/city/i, /town/i],
  state: [/state|province/i],
  zip: [/zip|postal/i],
  // Identity — only filled when present in the LOCAL vault (opt-in).
  dateOfBirth: [/date of birth/i, /\bdob\b/i, /birth ?date/i, /\bd\.?o\.?b\.?\b/i],
  ssn: [/\bssn\b/i, /social security/i, /\bsocial\b/i, /tax ?(payer )?id/i, /\btin\b/i],
};

// Some banks split one identity value across several inputs — DOB into
// Month/Day/Year (often <select>s), SSN into area/group/serial boxes. A single
// vault value (dateOfBirth / ssn) must be distributed across them. These specs
// are matched BEFORE the plain FIELD_HINTS, because a sub-field label like
// "SSN area number" also matches the plain "ssn" hint — the part must win.
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** "01/15/1990" or "1990-01-15" → candidate strings per part (most-canonical first). */
function dobParts(val) {
  const m = String(val).match(/(\d{1,4})\D(\d{1,2})\D(\d{1,4})/);
  if (!m) return null;
  let month, day, year;
  if (m[1].length === 4) [year, month, day] = [m[1], m[2], m[3]];
  else [month, day, year] = [m[1], m[2], m[3]];
  const mi = Number(month);
  if (!(mi >= 1 && mi <= 12) || !year) return null;
  const pad = (s) => String(Number(s)).padStart(2, "0");
  return {
    month: [pad(month), String(mi), MONTH_NAMES[mi - 1], MONTH_NAMES[mi - 1].slice(0, 3)],
    day: [pad(day), String(Number(day))],
    year: [year],
  };
}

/** "123-45-6789" → { ssn1:[area], ssn2:[group], ssn3:[serial] } (9 digits only). */
function ssnParts(val) {
  const d = String(val).replace(/\D/g, "");
  if (d.length !== 9) return null;
  return { ssn1: [d.slice(0, 3)], ssn2: [d.slice(3, 5)], ssn3: [d.slice(5)] };
}

// NOTE: month/day/year hints deliberately avoid bare mm/dd/yyyy tokens — a
// COMBINED "Date of Birth" field with a "MM/DD/YYYY" placeholder would otherwise
// match the day/month/year part and get a single part instead of the whole date.
// A guard below also skips these whenever the combined dateOfBirth hint matches.
const COMPOSITE_FIELDS = {
  dobMonth: { from: "dateOfBirth", part: "month", parse: dobParts, hints: [/birth ?month/i, /month of birth/i, /^month$/i] },
  dobDay: { from: "dateOfBirth", part: "day", parse: dobParts, hints: [/birth ?day/i, /day of birth/i, /^day$/i] },
  dobYear: { from: "dateOfBirth", part: "year", parse: dobParts, hints: [/birth ?year/i, /year of birth/i, /^year$/i] },
  ssnArea: { from: "ssn", part: "ssn1", parse: ssnParts, hints: [/ssn.*area/i, /area number/i, /ssn.?1\b/i, /ssn part ?1/i] },
  ssnGroup: { from: "ssn", part: "ssn2", parse: ssnParts, hints: [/ssn.*group/i, /group number/i, /ssn.?2\b/i, /ssn part ?2/i] },
  ssnSerial: { from: "ssn", part: "ssn3", parse: ssnParts, hints: [/ssn.*serial/i, /serial number/i, /ssn.?3\b/i, /ssn part ?3/i] },
};

/** Fill a <select> (try each candidate as value then label) or an input (first candidate). */
async function fillOne(el, tag, candidates) {
  if (tag === "select") {
    for (const c of candidates) {
      if (await el.selectOption({ value: c }).then(() => true).catch(() => false)) return true;
      if (await el.selectOption({ label: c }).then(() => true).catch(() => false)) return true;
    }
    return false;
  }
  return el.fill(candidates[0]).then(() => true).catch(() => false);
}

export async function prefill(page, vault, allowedKeys) {
  // Reach into <iframe>s too — banks/KYC vendors often render the real form in a
  // frame, and Playwright selectors don't descend into frames on their own.
  const frames = typeof page.frames === "function" ? page.frames() : [page];
  const inputs = (
    await Promise.all(frames.map((f) => f.$$("input:visible, select:visible").catch(() => [])))
  ).flat();
  log(`prefill: ${inputs.length} visible input/select field(s) across ${frames.length} frame(s)`);
  const filledKeys = [];
  let filled = 0;
  for (const el of inputs) {
    const tag = await el.evaluate((n) => n.tagName.toLowerCase()).catch(() => "input");
    const type = (await el.getAttribute("type")) ?? "text";
    // NOTE: `password` is NOT skipped — banks mask SSN as type="password". Only a
    // field whose label matches a FIELD_HINTS regex is ever filled, and the vault
    // has no "password" key, so a "create a password" input is never touched.
    if (tag !== "select" && ["hidden", "submit", "button", "checkbox", "radio", "file"].includes(type))
      continue;
    // Build the field descriptor IN-BROWSER so we can resolve the associated
    // <label> — real bank forms often label a field only by <label for="opaqueId">
    // (or a wrapping <label>, or aria-labelledby), with no aria-label/name/
    // placeholder. Reading just the attributes misses those (the real BMO run
    // filled 6/21 for exactly this reason). CSS.escape is a browser global here.
    const meta = (
      await el
        .evaluate((n) => {
          const parts = [];
          const push = (s) => {
            if (s && s.trim()) parts.push(s.trim());
          };
          push(n.getAttribute("aria-label"));
          push(n.getAttribute("name"));
          push(n.getAttribute("placeholder"));
          push(n.id);
          if (n.id)
            for (const l of document.querySelectorAll(`label[for="${CSS.escape(n.id)}"]`)) push(l.textContent);
          const wrap = n.closest("label");
          if (wrap) push(wrap.textContent);
          const lb = n.getAttribute("aria-labelledby");
          if (lb)
            for (const id of lb.split(/\s+/)) {
              const e = document.getElementById(id);
              if (e) push(e.textContent);
            }
          return parts.join(" ").replace(/\s+/g, " ").trim();
        })
        .catch(() => "")
    ).toLowerCase();
    if (!meta) continue;

    // Composite identity sub-fields first (split DOB / split SSN). Matched before
    // the plain hints so a "SSN area"/"Birth month" box gets its PART, not the
    // whole value. A matched-but-unparseable value still consumes the field
    // (`handled`) so the plain loop won't then dump the full value into it.
    // Part hints (birth month/day/year) only match a genuine sub-field — a
    // COMBINED "Date of Birth" field (even one with a MM/DD/YYYY placeholder) won't
    // match them, so it falls through to the plain loop and gets the whole value.
    let handled = false;
    for (const [ck, spec] of Object.entries(COMPOSITE_FIELDS)) {
      if (!allowedKeys.includes(spec.from) || vault[spec.from] == null) continue;
      if (!spec.hints.some((re) => re.test(meta))) continue;
      handled = true;
      const parts = spec.parse(String(vault[spec.from]));
      const candidates = parts?.[spec.part];
      if (!candidates) {
        log(`  skipped "${ck}" (couldn't parse ${spec.from} into parts)`);
        break;
      }
      if (await fillOne(el, tag, candidates)) {
        filled++;
        filledKeys.push(ck);
        log(`  filled "${ck}" ← ${tag} matched on label "${meta.slice(0, 40)}"`);
      } else {
        log(`  could not fill "${ck}" (${tag} — no matching option)`);
      }
      break;
    }
    if (handled) continue;

    for (const key of allowedKeys) {
      if (vault[key] == null) continue;
      if ((FIELD_HINTS[key] ?? []).some((re) => re.test(meta))) {
        const val = String(vault[key]); // value NEVER logged
        try {
          if (tag === "select") {
            // A <select> can't be .fill()'d — pick the option by value or label
            // (e.g. state "GA" or "Georgia"). Try each form until one matches.
            await el
              .selectOption({ value: val })
              .catch(() => el.selectOption({ label: val }))
              .catch(() => el.selectOption(val));
          } else {
            await el.fill(val);
          }
          filled++;
          filledKeys.push(key);
          log(`  filled "${key}" ← ${tag} matched on label "${meta.slice(0, 40)}"`);
        } catch {
          log(`  could not fill "${key}" (${tag} — no matching option / not editable)`);
        }
        break;
      }
    }
  }
  log(`prefill: filled ${filled} field(s) [${filledKeys.join(", ") || "none"}]`);
  return filled;
}

// ── Guided click-through ──────────────────────────────────────────────────────
// Bank "apply" links often land on a marketing page whose real application is a
// click away (through a ZIP modal, an "Open an account" CTA, etc.). The agent
// detects the next navigational button, tells the user exactly what it is, and
// (with consent) clicks it — advancing page by page until the identity/KYC step,
// where it always stops. It NEVER clicks submit / e-sign / identity actions.
// Page CTAs that move toward the application.
const ADVANCE_RE =
  /^(open (an )?account|apply( now| online| today)?|get started|open now|continue|confirm|next|proceed|enroll|start( application)?)\.?$/i;
// Inside a gate modal (ZIP/location/"see results"), these primary buttons submit
// the field we just filled and clear the overlay — navigational, not an app submit.
const MODAL_ADVANCE_RE =
  /^(confirm|continue|submit|update|see results|apply|go|ok|okay|done|next|yes|proceed)\.?$/i;
// Never auto-click these anywhere.
const AVOID_RE =
  /(sign ?in|log ?in|e-?sign|i agree|^agree|accept|verify (your )?identity|upload|cancel|close|dismiss|^back$|no thanks|maybe later)/i;
// On a full page (not a modal) also avoid a bare "submit" (could be an app submit).
const PAGE_AVOID_RE = /submit/i;
// Fields that mean we've reached identity/KYC — stop auto-advancing there.
const IDENTITY_RE = /ssn|social security|date of birth|\bdob\b|mother'?s maiden|driver'?s license/i;
// A cookie/consent banner — accepting one is benign and clears the overlay so the
// real application gate is reachable. Detected by container text, dismissed by
// its accept button (never mistaken for the app gate).
const CONSENT_RE = /cookie|consent|gdpr|privacy|tracking preference/i;
const CONSENT_ACCEPT_RE = /^(accept|agree|allow|got it|ok|okay|i understand|enable|continue)/i;

/** Dismiss a cookie/consent banner (click its accept button). Returns true if one. */
async function dismissConsent(page) {
  const containers = await page.$$(
    "[role='dialog']:visible, [class*='cookie']:visible, [id*='cookie']:visible, [class*='consent']:visible, [id*='consent']:visible",
  );
  for (const c of containers) {
    const txt = ((await c.innerText().catch(() => "")) || "").toLowerCase();
    const aria = ((await c.getAttribute("aria-label").catch(() => "")) || "").toLowerCase();
    if (!CONSENT_RE.test(txt) && !CONSENT_RE.test(aria)) continue;
    const btns = await c.$$("button:visible, [role='button']:visible, a:visible");
    for (const b of btns) {
      const t = await elText(b);
      if (t && t.length < 30 && CONSENT_ACCEPT_RE.test(t)) {
        try {
          await b.click({ timeout: 3000 });
          log(`dismissed consent banner via "${t}"`);
          await page.waitForTimeout(200);
          return true;
        } catch {
          /* try next button */
        }
      }
    }
  }
  return false;
}

async function elText(el) {
  const raw =
    (await el.innerText().catch(() => "")) ||
    (await el.getAttribute("value").catch(() => "")) ||
    (await el.getAttribute("aria-label").catch(() => "")) ||
    "";
  return raw.trim().replace(/\s+/g, " ");
}

/** The first visible modal/dialog that actually contains a button, else null. */
export async function findOpenModal(page) {
  const sels = [
    "[role='dialog']",
    "[aria-modal='true']",
    "dialog[open]",
    "[class*='modal']",
    "[class*='Modal']",
    "[class*='overlay']",
  ];
  for (const sel of sels) {
    for (const el of await page.$$(`${sel}:visible`)) {
      const hasBtn = await el.$("button:visible, [role='button']:visible, input[type='submit']:visible");
      if (hasBtn) return el;
    }
  }
  return null;
}

/**
 * Ranked list of candidate "advance" buttons (deduped by text, best first). If a
 * gate modal is open, only its buttons are considered (they submit the field just
 * filled and clear the overlay); otherwise page CTAs. Ranking is only a *default*
 * — because a marketing page has many similar CTAs, the user picks from the list.
 * Returns [{ el, txt, inModal }].
 */
export async function findAdvanceCtas(page) {
  const modal = await findOpenModal(page);
  const scope = modal ?? page;
  const matchRe = modal ? MODAL_ADVANCE_RE : ADVANCE_RE;
  const els = await scope.$$(
    "a:visible, button:visible, [role='button']:visible, input[type='submit']:visible",
  );
  const cands = [];
  const seen = new Set();
  for (const el of els) {
    const txt = await elText(el);
    if (!txt || txt.length > 32) continue;
    if (AVOID_RE.test(txt)) continue;
    if (!modal && PAGE_AVOID_RE.test(txt)) continue;
    if (!matchRe.test(txt)) continue;
    const key = txt.toLowerCase();
    if (seen.has(key)) continue; // dedupe identical labels (nav + hero + footer)
    seen.add(key);
    // A CTA inside site nav/header/footer is usually a decoy — the real
    // application button lives in the main content. Deprioritise it so the
    // default (and --auto) picks the hero CTA, not a menu link.
    const nav = await el
      .evaluate((n) => !!n.closest("nav,header,footer,[role='navigation'],[role='banner'],[role='contentinfo']"))
      .catch(() => false);
    cands.push({ el, txt, inModal: !!modal, nav });
  }
  const rank = (c) => {
    let r = modal
      ? /confirm|continue|submit|see results|update|yes|ok/i.test(c.txt)
        ? 2
        : 1
      : /open (an )?account|open now|apply/i.test(c.txt)
        ? 3
        : /get started|proceed|start/i.test(c.txt)
          ? 2
          : 1;
    if (!modal && c.nav) r -= 2; // push nav/header/footer CTAs below main-content ones
    return r;
  };
  // Stable sort by rank desc; DOM order preserved within a rank.
  cands.sort((a, b) => rank(b) - rank(a));
  return cands.slice(0, 6);
}

/**
 * Click a button by its visible text, re-located FRESH at click time (the user
 * prompt can take seconds, during which a modal re-renders and any handle we held
 * goes stale → "Element is not attached to the DOM"). Returns true if clicked.
 */
export async function clickByText(page, txt, inModal) {
  // Retry a few times: on a re-rendering modal the node can detach between
  // locate and click ("Element is not attached to the DOM"); re-locating fresh
  // each attempt rides it out instead of failing on a transient race.
  for (let attempt = 0; attempt < 3; attempt++) {
    const modal = inModal ? await findOpenModal(page) : null;
    const scope = modal ?? page;
    const els = await scope.$$(
      "a:visible, button:visible, [role='button']:visible, input[type='submit']:visible",
    );
    let found = null;
    for (const el of els) {
      if ((await elText(el)).toLowerCase() === txt.toLowerCase()) {
        found = el;
        break;
      }
    }
    if (!found) {
      if (attempt === 2) {
        log(`could not re-locate "${txt}" to click`);
        return false;
      }
      await page.waitForTimeout(200);
      continue;
    }
    try {
      await found.click({ timeout: 5000 });
      return true;
    } catch (e) {
      if (attempt === 2) {
        log(`click failed after retries: ${String(e).slice(0, 140)}`);
        return false;
      }
      await page.waitForTimeout(200);
    }
  }
  return false;
}

/**
 * Human-readable label for a radio/checkbox input. Resolved entirely inside the
 * browser context (label[for], aria-label, wrapping <label>, or the next sibling)
 * — `CSS.escape`/`document` are browser globals, not available in Node.
 */
export async function inputLabel(_scope, el) {
  const t = await el
    .evaluate((node) => {
      if (node.id) {
        const byId = document.querySelector(`label[for="${CSS.escape(node.id)}"]`);
        if (byId && byId.textContent.trim()) return byId.textContent.trim();
      }
      if (node.getAttribute("aria-label")) return node.getAttribute("aria-label");
      const lab = node.closest("label");
      if (lab && lab.textContent.trim()) return lab.textContent.trim();
      const sib = node.nextElementSibling || node.parentElement?.nextElementSibling;
      return sib ? sib.textContent.trim() : "";
    })
    .catch(() => "");
  return (t || "option").replace(/\s+/g, " ").slice(0, 70);
}

/**
 * Unselected radio groups on the current step — these usually block progress
 * (e.g. "choose an account option"). Returns [{ name, options:[{el,label}] }].
 * The user picks, because it's a real choice (bundle a savings account?, etc.).
 */
export async function findChoiceGroups(scope) {
  const radios = await scope.$$("input[type='radio']:visible");
  const byName = new Map();
  for (const el of radios) {
    const name = (await el.getAttribute("name").catch(() => null)) || "(unnamed)";
    const checked = await el.isChecked().catch(() => false);
    if (!byName.has(name)) byName.set(name, { name, options: [], anyChecked: false });
    const g = byName.get(name);
    g.options.push({ el, label: await inputLabel(scope, el) });
    if (checked) g.anyChecked = true;
  }
  return [...byName.values()].filter((g) => g.options.length >= 2 && !g.anyChecked);
}

/**
 * True if the current page shows identity/KYC fields (SSN/DOB/etc.). Only VISIBLE
 * fields count — an SPA pre-renders later steps (incl. the identity form) hidden
 * in the DOM, so a non-visible query would falsely fire on the very first page.
 */
export async function atIdentityStep(page) {
  // Check every frame — the identity/KYC fields may live inside an <iframe>, and
  // we must STOP there just as we would on the main page.
  const frames = typeof page.frames === "function" ? page.frames() : [page];
  for (const frame of frames) {
    const blob = await frame
      .$$eval("input:visible, label:visible", (els) =>
        els
          .map(
            (e) =>
              e.textContent ||
              e.getAttribute("aria-label") ||
              e.getAttribute("name") ||
              e.getAttribute("placeholder") ||
              "",
          )
          .join(" ")
          .toLowerCase(),
      )
      .catch(() => "");
    if (IDENTITY_RE.test(blob)) return true;
  }
  return false;
}

/**
 * Ask which candidate button to click (TTY). Returns an index (0-based) to click,
 * or "skip" / "stop". Enter picks the default (0).
 */
function promptChoice(count) {
  if (!process.stdin.isTTY) return Promise.resolve("skip");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(
      `   ${dim(`[Enter]=1 · type 1-${count} to pick · s = I'll click it myself · q = stop`)} `,
      (a) => {
        rl.close();
        const t = a.trim().toLowerCase();
        if (t === "q") return resolve("stop");
        if (t === "s") return resolve("skip");
        if (t === "") return resolve(0);
        const n = Number.parseInt(t, 10);
        resolve(Number.isInteger(n) && n >= 1 && n <= count ? n - 1 : 0);
      },
    );
  });
}

/**
 * --auto chooser: answer prompts automatically, no keypress. CTAs take the
 * best-ranked option (index 0). For a real choice (radio group), prefer a
 * DECLINE-style option ("No…", "…only", "decline") so we don't silently bundle
 * an add-on; otherwise the first. You still review before the final submit.
 */
export function autoChoose(kind, count, items) {
  if (kind === "choice") {
    const i = items.findIndex((o) => /^\s*no\b|\bonly\b|decline|not now|no thanks/i.test(o.label || ""));
    const pick = i >= 0 ? i : 0;
    log(`auto-picked choice "${items[pick]?.label}"`);
    return pick;
  }
  log(`auto-picked "${items[0]?.txt}"`);
  return 0;
}

/**
 * Drive the application forward: prefill → find the next CTA → prompt/click →
 * repeat, up to MAX steps, stopping at identity/KYC. Returns the active page
 * (which may be a new tab opened by a click).
 */
// opts (all optional — used by the automated test harness):
//   choose(kind, count, items) → index | "skip" | "stop"  (default: TTY prompt)
//   quiet   suppress the user-facing console output (default false)
//   test    skip cloud progress reports (default false)
//   settleMs  wait after a click (default 2500; tests use a small value)
export async function driveSteps(page, vault, job, opts = {}) {
  const choose = opts.choose ?? ((kind, count) => promptChoice(count));
  const say = opts.quiet ? () => {} : (...a) => console.log(...a);
  const doReport = opts.test ? async () => {} : report;
  const settleMs = opts.settleMs ?? 2500;
  const MAX = 8;
  let cur = page;
  let lastSig = null; // state we last acted on — to detect "click did nothing"
  let stuck = 0;
  for (let step = 1; step <= MAX; step++) {
    // Clear any cookie/consent overlay first, else it masquerades as the gate.
    await dismissConsent(cur);
    const filled = await prefill(cur, vault, job.autofillFields);
    await snap(cur, `step-${step}`);
    if (filled) say(`Pre-filled ${filled} field(s) on this page.`);
    if (step === 1) await doReport("prefilled", "open_account", `Pre-filled ${filled} field(s).`);

    if (await atIdentityStep(cur)) {
      log("reached identity/KYC step — handing over");
      // If you put dateOfBirth/ssn in your local vault, prefill (above) already
      // filled them from disk — but the agent still STOPS here: you review the
      // values, clear any CAPTCHA / ID check, and click submit yourself.
      const hasIdentityInVault = (job.identityFields ?? []).some((k) => vault[k] != null);
      say(
        yellow(
          hasIdentityInVault
            ? "\n🔒 Identity step. I pre-filled SSN/DOB from your local vault — review them, do any CAPTCHA/ID check, and submit. I never click submit."
            : "\n🔒 This is the identity step (SSN/DOB). That's yours — I stop here.",
        ),
      );
      return cur;
    }

    // A wizard step may require a CHOICE (e.g. "bundle a savings account?") before
    // its Continue works. Detect unselected radio groups and let the user pick.
    const scopeForChoice = (await findOpenModal(cur)) ?? cur;
    const groups = await findChoiceGroups(scopeForChoice);
    let handedOver = false;
    for (const g of groups) {
      say("\n🔘 This step needs a choice — which option?");
      g.options.forEach((o, i) => say(`   ${bold(String(i + 1))}) ${o.label}`));
      const pick = await choose("choice", g.options.length, g.options);
      if (pick === "stop" || pick === "skip") {
        say(yellow("\n⏸  Ok — make the selection in the browser and continue there; I'll wait."));
        handedOver = true;
        break;
      }
      const opt = g.options[pick];
      log(`selecting radio "${opt.label}"`);
      say(dim(`Selecting "${opt.label}"…`));
      await opt.el.check({ timeout: 5000 }).catch(async () => {
        await opt.el.click({ timeout: 5000 }).catch((e) => log(`radio select failed: ${String(e).slice(0, 120)}`));
      });
      stuck = 0; // making a selection is progress
      await cur.waitForTimeout(Math.min(settleMs, 400));
    }
    if (handedOver) break;

    const ctas = await findAdvanceCtas(cur);
    if (!ctas.length) {
      log("no advance CTA detected — handing over");
      break;
    }

    // Signature of the current state. If it matches the state we just acted on,
    // the previous click changed nothing → the flow needs the user's input.
    // Include the visible field set: a single-URL SPA wizard shows the same
    // "Continue" on every step, so CTA labels alone can't tell steps apart —
    // fold in the fields so distinct steps get distinct signatures, while a
    // genuinely non-advancing repeat still matches.
    const fieldSig = await cur
      .$$eval("input:visible, select:visible", (els) =>
        els
          .map((e) =>
            (
              e.getAttribute("aria-label") ||
              e.getAttribute("name") ||
              e.getAttribute("placeholder") ||
              e.type ||
              ""
            )
              .toLowerCase()
              .trim(),
          )
          .sort()
          .join(","),
      )
      .catch(() => "");
    const sig = `${cur.url()}::${ctas.map((c) => c.txt.toLowerCase()).sort().join("|")}::${fieldSig}`;
    if (sig === lastSig) {
      stuck++;
      if (ctas.length === 1 || stuck >= 2) {
        log(`no progress after last click (stuck=${stuck}) — handing over`);
        say(
          yellow(
            "\n⏸  This step didn't advance — the bank's flow needs your input here.\n" +
              "    Take it from here in the browser; I'll wait. (This is the multi-step\n" +
              "    account form — your choices + identity verification are yours to complete.)",
          ),
        );
        break;
      }
      say(yellow("↻ That didn't advance the page — pick a different option, or s to take over."));
    } else {
      stuck = 0;
    }
    log(`candidates: ${ctas.map((c) => `"${c.txt}"`).join(" | ")} inModal=${ctas[0].inModal}`);

    // Don't guess a single button — a page can have several look-alike CTAs.
    // Show the choices and let the user pick the right one (default = best guess).
    say(
      ctas[0].inModal
        ? "\n👉 Next — submit this popup. Which button?"
        : "\n👉 Next — which button opens the application?",
    );
    ctas.forEach((c, i) => say(`   ${bold(String(i + 1))}) ${c.txt}`));
    if (job.offer?.offerCode) say(dim(`   (promo/offer code for later: ${job.offer.offerCode})`));

    const choice = await choose("cta", ctas.length, ctas);
    if (choice === "stop") {
      log("user stopped auto-advance");
      break;
    }
    if (choice === "skip") {
      say(dim("Ok — click it yourself; I'll keep the page open."));
      break;
    }
    const cta = ctas[choice];

    log(`clicking "${cta.txt}" (choice ${choice + 1})`);
    say(dim(`Clicking "${cta.txt}"…`));
    lastSig = sig;
    const before = cur.url();
    // Re-locate the button by text at click time so a stale handle can't fail.
    const ok = await clickByText(cur, cta.txt, cta.inModal);
    // A click may open a new tab; follow the newest page if so.
    await cur.waitForLoadState("domcontentloaded", { timeout: 15_000 }).catch(() => {});
    await cur.waitForTimeout(settleMs);
    const pages = cur.context().pages();
    const newest = pages[pages.length - 1];
    if (newest && newest !== cur) {
      cur = newest;
      log("followed a newly-opened tab");
    }
    log(`after click: ok=${ok} url=${cur.url()} (was ${before}) title="${await cur.title().catch(() => "")}"`);
  }
  say(
    "\n->  Over to you: finish anything remaining, complete identity verification, and submit.\n" +
      "    The browser stays open. Close it when you're done.",
  );
  return cur;
}

// POST a new campaign for an offer; returns the new campaign id.
async function startCampaignFor(offerId) {
  const { campaignId: newId } = await fetchJson("/api/campaigns", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ offerId }),
  });
  return newId;
}

// --offers: list offers you can start a campaign for (aligned + colored table).
async function cmdOffers() {
  const { offers } = await fetchJson("/api/offers");
  if (!offers?.length) {
    console.log("No offers. Run `npm run db:discover` (or `npm run db:seed`) first.");
    return;
  }
  console.log(bold(`Offers (${offers.length})`) + dim("   start one with:  node run.mjs --start <id>\n"));
  const { rows } = offersTable(offers);
  for (let i = 0; i < rows.length; i++) {
    // Prefix each with its id so the printed list stays copy-pasteable.
    console.log(`${dim(offers[i].id)}  ${rows[i].text}`);
  }
}

// --list: list campaigns you can run the agent against.
async function cmdList() {
  const { campaigns } = await fetchJson("/api/campaigns");
  if (!campaigns?.length) {
    console.log("No campaigns yet. Start one:  node run.mjs --start <offerId>");
    return;
  }
  console.log(bold(`Campaigns (${campaigns.length})`) + dim(`   run one with:  node run.mjs ${BASE}/campaigns/<id>\n`));
  for (const c of campaigns) {
    console.log(`${dim(c.id)}  ${c.offer.institution} — ${c.offer.title}  ${dim("[" + c.status + "]")}`);
  }
}

// --start <offerId>: create a campaign, print its id + the ready-to-run command.
async function cmdStart(offerId) {
  if (!offerId) {
    console.error("usage: node run.mjs --start <offerId>   (get ids from `node run.mjs --offers`)");
    process.exit(1);
  }
  const newId = await startCampaignFor(offerId);
  console.log(
    [
      `Started campaign ${cyan(newId)}`,
      "",
      "Run it:",
      `  node run.mjs ${BASE}/campaigns/${newId} --dry-run   # test the handoff`,
      `  node run.mjs ${BASE}/campaigns/${newId}             # for real (opens Chrome)`,
    ].join("\n"),
  );
}

// --setup: interactively build the local vault (~/.yieldflow/vault.json). Prompts
// in the user's terminal; NOTHING is sent anywhere — identity data stays on-device.
const SETUP_FIELDS = [
  ["firstName", "First name"],
  ["middleName", "Middle name (optional)"],
  ["lastName", "Last name"],
  ["dateOfBirth", "Date of birth (MM/DD/YYYY)"],
  ["ssn", "SSN — stays on THIS machine only, never sent to us (optional now)"],
  ["email", "Email"],
  ["phone", "Phone (digits only)"],
  ["addressLine1", "Street address"],
  ["addressLine2", "Apt / Suite / Unit (optional)"],
  ["city", "City"],
  ["state", "State (2-letter, e.g. GA)"],
  ["zip", "ZIP"],
];
async function cmdSetup() {
  let existing = {};
  try {
    existing = JSON.parse(readFileSync(VAULT_PATH, "utf8"));
    delete existing._comment;
  } catch {
    /* no existing vault */
  }
  console.log(
    `Set up your details — saved ONLY to ${VAULT_PATH} on this machine.\n` +
      "Nothing is ever sent to YieldFlow. Press Enter to keep the current value.\n",
  );

  // A line queue that works for both a TTY (waits per prompt) and piped input
  // (buffers lines; readline.question would drop queued lines on EOF).
  const rl = readline.createInterface({ input: process.stdin });
  const buffered = [];
  let waiting = null;
  let closed = false;
  rl.on("line", (l) => (waiting ? (waiting(l), (waiting = null)) : buffered.push(l)));
  rl.on("close", () => {
    closed = true;
    if (waiting) (waiting(null), (waiting = null));
  });
  const nextLine = () =>
    new Promise((res) => (buffered.length ? res(buffered.shift()) : closed ? res(null) : (waiting = res)));

  const out = {};
  for (const [key, label] of SETUP_FIELDS) {
    const def = existing[key];
    process.stdout.write(def ? `${label} [${def}]: ` : `${label}: `);
    const line = await nextLine();
    const v = (line == null ? "" : line.trim()) || def || "";
    if (v) out[key] = v;
    if (line == null) break; // stdin ended
  }
  rl.close();

  mkdirSync(dirname(VAULT_PATH), { recursive: true });
  writeFileSync(VAULT_PATH, JSON.stringify(out, null, 2));
  try {
    chmodSync(VAULT_PATH, 0o600);
  } catch {
    /* best-effort perms */
  }
  console.log(`\n✓ Saved ${Object.keys(out).length} field(s) to ${VAULT_PATH}`);
  console.log("Run  node run.mjs  to start a campaign, or add  --auto  to auto-answer the prompts.");
}

// No args on a TTY: pick an offer from the menu → start it → optionally open it.
async function cmdInteractive() {
  const { offers } = await fetchJson("/api/offers");
  if (!offers?.length) {
    console.log("No offers. Run `npm run db:discover` (or `npm run db:seed`) first.");
    return;
  }
  const chosen = await pickOffer(offers);
  if (!chosen) return;

  console.log(`${bold(chosen.institution)} — ${chosen.title}`);
  const newId = await startCampaignFor(chosen.id);
  console.log(`Started campaign ${cyan(newId)}`);

  const isWeb = chosen.applicationChannel === "web" && !!chosen.applicationUrl;
  if (!isWeb) {
    console.log(
      dim("This offer is app-only / has no web form — open it yourself; the agent can't drive it."),
    );
    console.log(`\nSee the checklist:\n  node run.mjs ${BASE}/campaigns/${newId} --dry-run`);
    return;
  }
  if (!chosen.applicationUrlVerified) {
    console.log(
      yellow(
        "\n⚠ Heads up: this bank link failed our resolves-check and may be outdated (e.g. 404).\n" +
          "  We'll still open it, but if it 404s, go to the bank's site and find this offer.",
      ),
    );
  }

  const go = auto ? true : await confirm("\nOpen it in Chrome now and pre-fill?");
  if (go) {
    await main(newId);
  } else {
    console.log(
      [
        "",
        "When ready:",
        `  node run.mjs ${BASE}/campaigns/${newId} --dry-run   # test`,
        `  node run.mjs ${BASE}/campaigns/${newId}             # for real (opens Chrome)`,
      ].join("\n"),
    );
  }
}

async function main(cid = campaignId) {
  activeCampaignId = cid;
  RUN_DIR = makeRunDir();
  log(`run start — base=${BASE} campaign=${cid} dryRun=${dryRun}`);
  console.log(`Fetching job for campaign ${cid} from ${BASE} ...`);
  job = await fetchJson(`/api/agent/job/${cid}`);
  log(
    `job: ${job.offer.brand} — ${job.offer.title} | channel=${job.offer.applicationChannel} ` +
      `verified=${job.offer.applicationUrlVerified} url=${job.offer.applicationUrl ?? "(none)"}`,
  );
  log(`steps: ${job.steps.map((s) => s.title).join(" → ")}`);
  const vault = loadVault();

  // Which fields WOULD be filled from the vault.
  const available = (job.autofillFields ?? []).filter((k) => vault[k] != null);

  console.log(`\nOffer:   ${job.offer.brand} — ${job.offer.title}`);
  console.log(
    `Apply:   ${job.offer.applicationUrl ?? "(app-only / none)"} [${job.offer.applicationChannel}]`,
  );
  if (
    job.offer.applicationChannel === "web" &&
    job.offer.applicationUrl &&
    !job.offer.applicationUrlVerified
  ) {
    console.log(
      yellow("Link:    ⚠ unverified — may be outdated (e.g. 404). If so, find this offer from the bank's site."),
    );
  }
  if (job.offer.offerCode) console.log(`Code:    ${job.offer.offerCode}`);
  if (job.offer.signupNotes) console.log(`Notes:   ${job.offer.signupNotes}`);
  console.log(`Steps:   ${job.steps.map((s) => s.title).join(" → ")}`);
  console.log(
    `Fill:    ${available.length ? available.join(", ") : "(vault empty — copy vault.example.json)"}`,
  );
  // Identity fields already in the vault get pre-filled from disk; the rest are
  // yours to type. Either way, CAPTCHA + the final submit are always yours.
  const identityToType = (job.identityFields ?? []).filter((k) => vault[k] == null);
  console.log(
    `You do:  ${[...identityToType, "CAPTCHA", "submit"].join(" + ")}` +
      (identityToType.length < (job.identityFields ?? []).length
        ? "   (SSN/DOB pre-filled from your vault — review before submit)"
        : ""),
  );

  if (dryRun) {
    log("dry-run: not opening a browser");
    console.log("\n--dry-run: not opening a browser. Handoff looks good.");
    printRunDir();
    return;
  }

  if (job.offer.applicationChannel !== "web" || !job.offer.applicationUrl) {
    log("not a web application — nothing to drive");
    await report("awaiting_user", "open_account", "App-only or no web form — complete in the app.");
    console.log("\nThis offer isn't a web application; open it yourself. Exiting.");
    printRunDir();
    return;
  }

  // Lazy-load Playwright only when we actually drive a browser, so --dry-run
  // works even before `npm install`.
  const { chromium } = await import("playwright-core");
  await report("started", "open_account", `Opening ${job.offer.brand}`);

  // Use the user's REAL installed Chrome (channel: 'chrome'), visible — a human
  // is genuinely present. No stealth, no fingerprint spoofing.
  let browser;
  let context;
  try {
    log("launching Chrome (channel: chrome, headed)");
    browser = await chromium.launch({ headless: false, channel: "chrome" });
    context = await browser.newContext(
      RUN_DIR ? { recordVideo: { dir: RUN_DIR } } : {},
    );
  } catch (err) {
    log(`Chrome launch failed: ${String(err).slice(0, 200)}`);
    console.error(
      "\nCouldn't launch Google Chrome. Is it installed? (the agent drives your real Chrome).\n" +
        String(err),
    );
    printRunDir();
    return;
  }
  const page = await context.newPage();

  try {
    log(`navigating to ${job.offer.applicationUrl}`);
    const resp = await page
      .goto(job.offer.applicationUrl, { waitUntil: "domcontentloaded", timeout: 45_000 })
      .catch((e) => {
        throw e;
      });
    await page.waitForTimeout(2500);
    const status = resp ? resp.status() : "?";
    const title = await page.title().catch(() => "");
    log(`loaded: status=${status} url=${page.url()} title="${title}"`);
    // Heuristic bot-wall / error detection (for diagnostics only).
    if (
      (typeof status === "number" && status >= 400) ||
      /just a moment|attention required|access denied|are you a human|verify you are/i.test(title)
    ) {
      log(`⚠ likely bot-wall / error page (status=${status}, title="${title}")`);
    }
    await snap(page, "01-loaded");

    // Guide the application forward (prefill → click next → repeat), stopping at
    // identity/KYC. Returns whatever page/tab we ended on.
    const active = await driveSteps(page, vault, job, auto ? { choose: autoChoose } : {});
    if (auto) console.log("(--auto: answered the prompts automatically — review the browser before you submit.)");

    await report(
      "awaiting_user",
      "open_account",
      "Ready for you: identity verification, any code, and submit.",
    );
    log("waiting for you to finish (browser open)…");

    await active.waitForEvent("close", { timeout: 0 }).catch(() => {});
    log("browser closed by user");
    await report("submitted", "open_account", "User finished the application.");
  } catch (err) {
    const msg = String(err);
    const blocked = /ERR_CONNECTION|net::|timeout/i.test(msg);
    log(`${blocked ? "blocked" : "failed"}: ${msg.slice(0, 300)}`);
    await snap(page, "error");
    await report(blocked ? "blocked" : "failed", "open_account", msg.slice(0, 180));
    console.error(
      blocked
        ? "\nThe bank blocked the automated browser — complete it manually in the open window."
        : "\n" + msg,
    );
  } finally {
    // Close the context first so the video flushes to disk, then the browser.
    await context?.close().catch(() => {});
    await browser?.close().catch(() => {});
    log("run end");
    printRunDir();
  }
}

// Tell the user where the diagnostics landed + how to share them.
function printRunDir() {
  if (!RUN_DIR) return;
  console.log(
    "\n" +
      dim("────────────────────────────────────────────────────────\n") +
      `📁 Run recorded: ${bold(RUN_DIR)}\n` +
      dim(
        "   Share run.log + the .png screenshots for help diagnosing.\n" +
          "   (Logs field names only, never your data. Screenshots/video may show\n" +
          "    pre-filled name/address/email — no SSN — so review before sharing.)",
      ),
  );
}

// Only run the CLI when executed directly — importing this module (e.g. from the
// test harness) must NOT parse argv, prompt, or launch a browser.
const isMain = (() => {
  try {
    return import.meta.url === pathToFileURL(process.argv[1] ?? "").href;
  } catch {
    return false;
  }
})();

if (isMain) {
  if (!SUBCOMMAND && !wantInteractive && !campaignId) usageAndExit();
  const entry = wantInteractive
    ? cmdInteractive()
    : SUBCOMMAND === "setup"
      ? cmdSetup()
      : SUBCOMMAND === "offers"
        ? cmdOffers()
        : SUBCOMMAND === "list"
          ? cmdList()
          : SUBCOMMAND === "start"
            ? cmdStart(startOfferId)
            : main();

  entry.catch((err) => {
    console.error(String(err));
    process.exit(1);
  });
}
