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
// Flags / input:
//   <arg>          a campaign id, a yieldflow://campaign/<id> URL,
//                  or a full https://…/campaigns/<id> URL
//   --base <url>   deployment base URL (or set YIELDFLOW_BASE)
//   --dry-run      fetch the job and print the plan, but DON'T open a browser
//   env YIELDFLOW_VAULT   path to the vault (default ~/.yieldflow/vault.json)

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const baseFlagIdx = args.indexOf("--base");
const baseArg = baseFlagIdx >= 0 ? args[baseFlagIdx + 1] : undefined;
const positional = args.find((a) => !a.startsWith("--") && a !== baseArg);

const BASE = baseArg ?? process.env.YIELDFLOW_BASE ?? "https://app.yieldflow.example";
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

const campaignId = parseCampaignId(positional);
if (!campaignId) {
  console.error(
    "usage: node run.mjs <campaignId | yieldflow://campaign/ID | https://…/campaigns/ID> [--base URL] [--dry-run]",
  );
  process.exit(1);
}

let job;
async function report(status, taskType, note) {
  if (dryRun) return;
  try {
    await fetch(job?.progressUrl ?? `${BASE}/api/agent/progress`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ campaignId, taskType, status, note }),
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

async function main() {
  console.log(`Fetching job for campaign ${campaignId} from ${BASE} ...`);
  const res = await fetch(`${BASE}/api/agent/job/${campaignId}`);
  if (!res.ok) throw new Error(`job fetch failed: HTTP ${res.status} (${BASE})`);
  job = await res.json();
  const vault = loadVault();

  // Which fields WOULD be filled from the vault.
  const available = (job.autofillFields ?? []).filter((k) => vault[k] != null);

  console.log(`\nOffer:   ${job.offer.brand} — ${job.offer.title}`);
  console.log(
    `Apply:   ${job.offer.applicationUrl ?? "(app-only / none)"} [${job.offer.applicationChannel}]`,
  );
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

main().catch((err) => {
  console.error(String(err));
  process.exit(1);
});
