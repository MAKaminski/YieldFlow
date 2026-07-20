#!/usr/bin/env node
// YieldFlow desktop-agent sidecar.
//
// Runs on the USER's machine. Given a campaign id (from the yieldflow:// deep
// link), it fetches the job from the cloud, opens the bank application in a
// REAL browser (the user's installed Chrome), pre-fills the non-identity fields
// from the local vault, then PAUSES for the user to complete identity
// verification, CAPTCHA, and submit. It reports progress back to the cloud.
//
// It does NOT impersonate, spoof, or evade detection: a real human is present
// and completes every human/identity step. If a bank blocks even this, it
// leaves the page open with the values ready to paste (graceful fallback).
//
// Usage:  node run.mjs <campaignId>
//   env:  YIELDFLOW_BASE  (default https://app.yieldflow.example)
//         YIELDFLOW_VAULT (default ~/.yieldflow/vault.json)

import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const BASE = process.env.YIELDFLOW_BASE ?? "https://app.yieldflow.example";
const VAULT_PATH = process.env.YIELDFLOW_VAULT ?? join(homedir(), ".yieldflow", "vault.json");

const campaignId = process.argv[2]?.replace(/^yieldflow:\/\/campaign\//, "");
if (!campaignId) {
  console.error("usage: run.mjs <campaignId | yieldflow://campaign/ID>");
  process.exit(1);
}

let job;
async function report(status, taskType, note) {
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
    return JSON.parse(readFileSync(VAULT_PATH, "utf8"));
  } catch {
    console.warn(`No vault at ${VAULT_PATH}; nothing to pre-fill.`);
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
    if (["hidden", "submit", "button", "checkbox", "radio", "file"].includes(type)) continue;
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
      const hints = FIELD_HINTS[key] ?? [];
      if (hints.some((re) => re.test(meta))) {
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
  if (!res.ok) throw new Error(`job fetch failed: ${res.status}`);
  job = await res.json();

  const vault = loadVault();
  await report("started", "open_account", `Opening ${job.offer.brand}`);

  if (job.offer.applicationChannel !== "web" || !job.offer.applicationUrl) {
    await report("awaiting_user", "open_account", "App-only or no web form — complete in the app.");
    console.log("This offer isn't a web application; nothing to drive. Exiting.");
    return;
  }

  // Use the user's REAL installed Chrome (channel: 'chrome'), visible, so a
  // human is genuinely present. No stealth, no fingerprint spoofing.
  const browser = await chromium.launch({ headless: false, channel: "chrome" });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.goto(job.offer.applicationUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForTimeout(2500);

    const filled = await prefill(page, vault, job.autofillFields);
    await report("prefilled", "open_account", `Pre-filled ${filled} field(s).`);
    console.log(`Pre-filled ${filled} field(s).`);

    if (job.offer.offerCode) console.log(`Promo/offer code to enter: ${job.offer.offerCode}`);
    if (job.offer.signupNotes) console.log(`Note: ${job.offer.signupNotes}`);

    await report(
      "awaiting_user",
      "open_account",
      "Ready for you: complete identity verification, any code, and submit.",
    );
    console.log(
      "\n➡  Over to you: finish identity verification, enter any promo code, and submit.\n" +
        "   The browser stays open. Close it when you're done.",
    );

    // Wait until the user closes the browser, then mark the step done.
    await page.waitForEvent("close", { timeout: 0 }).catch(() => {});
    await report("submitted", "open_account", "User finished the application.");
  } catch (err) {
    const msg = String(err);
    const blocked = /ERR_CONNECTION|net::|timeout/i.test(msg);
    await report(blocked ? "blocked" : "failed", "open_account", msg.slice(0, 180));
    console.error(blocked ? "The bank blocked the automated browser — complete it manually." : msg);
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
