// Automated end-to-end tests for the agent's guided click-through (driveSteps).
//
// Runs the REAL agent logic (imported from ../run.mjs) against faithful fake
// bank-flow fixtures in headless Chromium, with a scripted "user" chooser. This
// verifies the workflows here — modal gates, multi-CTA selection, radio choices,
// prefill, the identity stop, stale re-renders, and no-progress handover —
// without needing a real browser on a real bank site.
//
//   node test/drive.test.mjs      (or: npm test)
//
// Chromium: set PW_CHROMIUM to a chrome/chromium binary, else it tries the
// container's pinned build. On a dev machine: `npx playwright install chromium`
// and point PW_CHROMIUM at it.

import { chromium } from "playwright-core";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { driveSteps, atIdentityStep } from "../run.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => pathToFileURL(join(HERE, "fixtures", name)).href;

const execPath = [
  process.env.PW_CHROMIUM,
  "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
].find((p) => p && existsSync(p));

// A scripted user: pick the first candidate whose label contains one of the
// preferred substrings (in order), else the default (index 0).
function chooser(preferences) {
  return (_kind, _count, items) => {
    const labels = items.map((it) => (it.txt ?? it.label ?? "").toLowerCase());
    for (const pref of preferences) {
      const i = labels.findIndex((l) => l.includes(pref.toLowerCase()));
      if (i >= 0) return i;
    }
    return 0;
  };
}

const VAULT = {
  firstName: "Jordan",
  lastName: "Rivers",
  email: "jordan@example.com",
  phone: "5551234567",
  addressLine1: "123 Peachtree St",
  city: "Atlanta",
  state: "GA",
  zip: "30303",
};
const JOB = { autofillFields: Object.keys(VAULT), offer: {} };
const opts = (choose) => ({ choose, quiet: true, test: true, settleMs: 60 });

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    console.log(`  ✗ ${msg}`);
  }
}

async function withPage(browser, url, fn) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(url);
  try {
    return await fn(page);
  } finally {
    await context.close();
  }
}

async function main() {
  if (!execPath) {
    console.error(
      "No Chromium found. Set PW_CHROMIUM=<path> (or `npx playwright install chromium`).",
    );
    process.exit(2);
  }
  const browser = await chromium.launch({ headless: true, executablePath: execPath });

  try {
    console.log("BMO flow (ZIP → OPEN NOW → savings radio → form → identity):");
    await withPage(browser, fixture("bmo.html"), async (page) => {
      const choose = chooser(["open now", "no, open a checking", "continue", "confirm"]);
      await driveSteps(page, VAULT, JOB, opts(choose));
      const events = await page.evaluate(() => window.__events);

      assert(events.includes("confirm-zip"), "submitted the ZIP gate (CONFIRM)");
      assert(events.includes("open-now"), 'clicked "OPEN NOW" (not a decoy nav/footer CTA)');
      assert(
        !events.includes("nav:open-account") && !events.includes("footer:apply"),
        "did not click the decoy nav/footer CTAs",
      );
      assert(events.includes("savings:no"), "made the savings-bundle radio choice (No)");
      assert(
        !events.includes("savings-continue-blocked"),
        "chose before CONTINUE (never hit 'please choose an option')",
      );
      assert(events.includes("personal-continue"), "advanced past the personal-info form");
      assert(!events.includes("identity:submit"), "STOPPED at identity — never submitted");

      const vals = await page.evaluate(() => ({
        fn: document.getElementById("fn").value,
        zp: document.getElementById("zp").value,
        ci: document.getElementById("ci").value,
      }));
      assert(
        vals.fn === "Jordan" && vals.ci === "Atlanta" && vals.zp === "30303",
        "pre-filled first name, city, and ZIP on the form",
      );
    });

    console.log("Stuck wizard (CONTINUE that never advances):");
    await withPage(browser, fixture("stuck.html"), async (page) => {
      await driveSteps(page, VAULT, JOB, opts(chooser(["continue"])));
      const clicks = await page.evaluate(() => window.__continueClicks);
      assert(clicks <= 1, `clicked CONTINUE ≤1 time then handed over (was ${clicks})`);
    });

    console.log("Stale re-rendering button (Element-not-attached scenario):");
    await withPage(browser, fixture("stale.html"), async (page) => {
      await driveSteps(page, VAULT, JOB, opts(chooser(["confirm"])));
      const events = await page.evaluate(() => window.__events);
      const atIdentity = await page.evaluate(
        () => !document.getElementById("identity").classList.contains("hidden"),
      );
      assert(events.includes("confirm"), "clicked the continuously re-rendered CONFIRM button");
      assert(atIdentity, "advanced past the stale gate to the identity step");
    });

    console.log("Cookie-consent banner (must not be mistaken for the app gate):");
    await withPage(browser, fixture("cookie.html"), async (page) => {
      await driveSteps(page, VAULT, JOB, opts(chooser(["open now"])));
      const events = await page.evaluate(() => window.__events);
      const atIdentity = await page.evaluate(
        () => !document.getElementById("identity").classList.contains("hidden"),
      );
      assert(events.includes("cookie-accept"), "accepted/dismissed the cookie banner");
      assert(!events.includes("cookie-reject"), "did not click 'Reject All'");
      assert(events.includes("open-now"), "then reached and clicked the real OPEN NOW CTA");
      assert(atIdentity, "advanced to the identity step (banner didn't cause a handover)");
    });

    console.log("New-tab CTA (agent follows the opened tab):");
    await withPage(browser, fixture("newtab.html"), async (page) => {
      const active = await driveSteps(page, VAULT, JOB, opts(chooser(["open an account"])));
      assert(active.url().includes("newtab-app.html"), "followed the CTA into the new tab");
      assert(await atIdentityStep(active), "stopped at the identity step in the new tab");
    });
  } finally {
    await browser.close();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
