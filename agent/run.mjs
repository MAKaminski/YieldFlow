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
//   node run.mjs --offers            list offers you can start a campaign for
//   node run.mjs --start <offerId>   start a campaign, print its id + run command
//   node run.mjs --list              list campaigns you can run
//   node run.mjs <campaignId|URL>    run the agent (id, yieldflow://campaign/<id>,
//                                    or a full https://…/campaigns/<id> URL)
//
// Flags:
//   --base <url>   base URL (or YIELDFLOW_BASE); defaults to http://localhost:3000
//   --dry-run      fetch the job and print the plan, but DON'T open a browser
//   --bypass <t>   Vercel protection-bypass token (or set YIELDFLOW_BYPASS) —
//                  only needed against a protected preview URL; running the app
//                  locally at http://localhost:3000 avoids the auth wall entirely
//   env YIELDFLOW_VAULT   path to the vault (default ~/.yieldflow/vault.json)

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import readline from "node:readline";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
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
const startIdx = args.indexOf("--start");
const startOfferId = startIdx >= 0 ? args[startIdx + 1] : undefined;
const SUBCOMMAND = listOffers ? "offers" : listCampaigns ? "list" : startIdx >= 0 ? "start" : null;

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
  const cols = Math.max(60, (process.stdout.columns || 100) - 2);
  const bonusW = Math.max(...offers.map((o) => offerBonus(o).length), 5);
  // name column = whatever's left after index(3) + gaps + bonus + channel(~12)
  const nameW = Math.max(24, cols - 3 - 2 - bonusW - 2 - 12);
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
if (!SUBCOMMAND && !wantInteractive && !campaignId) {
  console.error(
    [
      "usage:",
      "  node run.mjs                                interactive menu (pick an offer)",
      "  node run.mjs --offers                       list offers you can start",
      "  node run.mjs --start <offerId>              start a campaign (prints its id)",
      "  node run.mjs --list                         list campaigns you can run",
      "  node run.mjs <campaignId | https://…/campaigns/ID>   run the agent",
      "",
      "  flags: [--base URL] [--bypass TOKEN] [--dry-run]",
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
  middleName: [/middle/i],
  email: [/e-?mail/i],
  phone: [/phone/i, /mobile/i, /tel/i],
  addressLine1: [/address ?1/i, /street/i, /^address$/i],
  addressLine2: [/address ?2/i, /apt|suite|unit/i],
  city: [/city/i, /town/i],
  state: [/state|province/i],
  zip: [/zip|postal/i],
};

async function prefill(page, vault, allowedKeys) {
  const inputs = await page.$$("input:visible, select:visible");
  let filled = 0;
  for (const el of inputs) {
    const type = (await el.getAttribute("type")) ?? "text";
    if (["hidden", "submit", "button", "checkbox", "radio", "file", "password"].includes(type))
      continue;
    const meta = (
      (await el.getAttribute("aria-label")) ||
      (await el.getAttribute("name")) ||
      (await el.getAttribute("placeholder")) ||
      (await el.getAttribute("id")) ||
      ""
    ).toLowerCase();
    if (!meta) continue;
    for (const key of allowedKeys) {
      if (vault[key] == null) continue;
      if ((FIELD_HINTS[key] ?? []).some((re) => re.test(meta))) {
        try {
          await el.fill(String(vault[key]));
          filled++;
        } catch {
          /* skip un-fillable */
        }
        break;
      }
    }
  }
  return filled;
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

  const go = await confirm("\nOpen it in Chrome now and pre-fill?");
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
  console.log(`Fetching job for campaign ${cid} from ${BASE} ...`);
  job = await fetchJson(`/api/agent/job/${cid}`);
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
  console.log(`You do:  ${(job.identityFields ?? []).join(", ")} + CAPTCHA + submit`);

  if (dryRun) {
    console.log("\n--dry-run: not opening a browser. Handoff looks good.");
    return;
  }

  if (job.offer.applicationChannel !== "web" || !job.offer.applicationUrl) {
    await report("awaiting_user", "open_account", "App-only or no web form — complete in the app.");
    console.log("\nThis offer isn't a web application; open it yourself. Exiting.");
    return;
  }

  // Lazy-load Playwright only when we actually drive a browser, so --dry-run
  // works even before `npm install`.
  const { chromium } = await import("playwright-core");
  await report("started", "open_account", `Opening ${job.offer.brand}`);

  // Use the user's REAL installed Chrome (channel: 'chrome'), visible — a human
  // is genuinely present. No stealth, no fingerprint spoofing.
  const browser = await chromium.launch({ headless: false, channel: "chrome" });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.goto(job.offer.applicationUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForTimeout(2500);

    const filled = await prefill(page, vault, job.autofillFields);
    await report("prefilled", "open_account", `Pre-filled ${filled} field(s).`);
    console.log(`\nPre-filled ${filled} field(s).`);
    if (job.offer.offerCode) console.log(`Enter promo/offer code: ${job.offer.offerCode}`);

    await report(
      "awaiting_user",
      "open_account",
      "Ready for you: identity verification, any code, and submit.",
    );
    console.log(
      "\n->  Over to you: finish identity verification, enter any promo code, and submit.\n" +
        "    The browser stays open. Close it when you're done.",
    );

    await page.waitForEvent("close", { timeout: 0 }).catch(() => {});
    await report("submitted", "open_account", "User finished the application.");
  } catch (err) {
    const msg = String(err);
    const blocked = /ERR_CONNECTION|net::|timeout/i.test(msg);
    await report(blocked ? "blocked" : "failed", "open_account", msg.slice(0, 180));
    console.error(
      blocked
        ? "\nThe bank blocked the automated browser — complete it manually in the open window."
        : "\n" + msg,
    );
  } finally {
    await browser.close().catch(() => {});
  }
}

const entry = wantInteractive
  ? cmdInteractive()
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
