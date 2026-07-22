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
import { driveSteps, atIdentityStep, autoChoose } from "../run.mjs";

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
  middleName: "Lee",
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

    console.log("Prefill: <select> dropdown + BMO-style street/middle-name fields:");
    await withPage(browser, fixture("selectform.html"), async (page) => {
      await driveSteps(page, VAULT, JOB, opts(chooser([])));
      const vals = await page.evaluate(() => ({
        mn: document.getElementById("mn").value,
        street: document.getElementById("street").value,
        state: document.getElementById("state").value,
      }));
      assert(vals.mn === "Lee", "filled middle name");
      assert(vals.street === "123 Peachtree St", "matched + filled BMO-style street field (by name)");
      assert(vals.state === "GA", "selected the state <select> option (GA)");
    });

    console.log("--auto mode (no prompts; declines the savings add-on):");
    await withPage(browser, fixture("bmo.html"), async (page) => {
      // Use the real autoChoose from run.mjs — this is what --auto runs.
      await driveSteps(page, VAULT, JOB, { choose: autoChoose, quiet: true, test: true, settleMs: 60 });
      const events = await page.evaluate(() => window.__events);
      assert(events.includes("open-now"), "auto-picked the OPEN NOW CTA");
      assert(events.includes("savings:no"), "auto-declined the savings add-on (chose 'No, checking only')");
      assert(events.includes("personal-continue"), "auto-advanced to the personal form");
      assert(!events.includes("identity:submit"), "still STOPPED at identity (never auto-submits)");
    });

    console.log("iframe-embedded form (agent must reach into the frame to fill + stop):");
    await withPage(browser, fixture("iframe.html"), async (page) => {
      const idVault = { ...VAULT, dateOfBirth: "01/15/1990", ssn: "123-45-6789" };
      const idJob = {
        autofillFields: Object.keys(idVault),
        identityFields: ["dateOfBirth", "ssn"],
        offer: {},
      };
      await driveSteps(page, idVault, idJob, opts(chooser([])));
      const frame = page.frames().find((f) => f.url().includes("iframe-inner"));
      const vals = await frame.evaluate(() => ({
        fn: document.getElementById("fn").value,
        ci: document.getElementById("ci").value,
        dob: document.getElementById("dob").value,
        ssn: document.getElementById("ssn").value,
        submitted: (window.__innerEvents || []).includes("identity:submit"),
      }));
      assert(vals.fn === "Jordan", "filled First name inside the iframe");
      assert(vals.ci === "Atlanta", "filled City inside the iframe");
      assert(vals.dob === "01/15/1990", "filled DOB inside the iframe");
      assert(vals.ssn === "123-45-6789", "filled masked SSN inside the iframe");
      assert(!vals.submitted, "STOPPED at the identity step inside the iframe (never submitted)");
    });

    console.log("Business (KYB) form — fills business fields + EIN, stops at owner SSN/DOB:");
    await withPage(browser, fixture("business.html"), async (page) => {
      const bizVault = {
        ...VAULT,
        dateOfBirth: "01/15/1990",
        ssn: "123-45-6789",
        businessName: "Rivers Widgets LLC",
        ein: "12-3456789",
        entityType: "LLC",
        formationState: "GA",
        formationDate: "03/04/2020",
        businessAddressLine1: "500 Market St",
        businessCity: "Atlanta",
      };
      const bizJob = {
        // Mirrors buildAgentJob for a business offer: business + identity keys included.
        autofillFields: Object.keys(bizVault),
        identityFields: ["dateOfBirth", "ssn", "ein"],
        offer: { audience: "business" },
      };
      await driveSteps(page, bizVault, bizJob, opts(chooser([])));
      const v = await page.evaluate(() => ({
        bn: document.getElementById("bn").value,
        ein: document.getElementById("ein").value,
        et: document.getElementById("et").value,
        fs: document.getElementById("fs").value,
        fd: document.getElementById("fd").value,
        ba: document.getElementById("ba").value,
        ssn: document.getElementById("ssn").value,
        dob: document.getElementById("dob").value,
      }));
      const events = await page.evaluate(() => window.__events);
      assert(v.bn === "Rivers Widgets LLC", "filled legal business name");
      assert(v.ein === "12-3456789", "filled EIN (opt-in, not an identity-stop trigger)");
      assert(v.et === "LLC", "selected entity type <select>");
      assert(v.fs === "GA", "filled state of formation");
      assert(v.fd === "03/04/2020", "filled date of formation");
      assert(v.ba === "500 Market St", "filled business address");
      assert(v.ssn === "123-45-6789" && v.dob === "01/15/1990", "pre-filled beneficial-owner SSN/DOB");
      assert(!events.includes("identity:submit"), "STOPPED at owner identity (never submitted)");
    });

    console.log("In-frame multi-step wizard (agent clicks CONTINUE inside the iframe, then stops):");
    await withPage(browser, fixture("iframe-wizard.html"), async (page) => {
      const idVault = { ...VAULT, dateOfBirth: "01/15/1990", ssn: "123-45-6789" };
      const idJob = {
        autofillFields: Object.keys(idVault),
        identityFields: ["dateOfBirth", "ssn"],
        offer: {},
      };
      await driveSteps(page, idVault, idJob, opts(chooser(["continue"])));
      const frame = page.frames().find((f) => f.url().includes("iframe-wizard-inner"));
      const state = await frame.evaluate(() => ({
        fn: document.getElementById("fn").value,
        dob: document.getElementById("dob").value,
        ssn: document.getElementById("ssn").value,
        stepBVisible: !document.getElementById("stepB").classList.contains("hidden"),
        events: window.__innerEvents || [],
      }));
      assert(state.fn === "Jordan", "filled the personal step inside the iframe");
      assert(state.events.includes("continue"), "clicked CONTINUE inside the iframe (advanced the wizard)");
      assert(state.stepBVisible, "advanced to the identity step inside the iframe");
      assert(state.dob === "01/15/1990" && state.ssn === "123-45-6789", "prefilled identity inside the iframe");
      assert(!state.events.includes("identity:submit"), "STOPPED at in-frame identity (never submitted)");
    });

    console.log("BMO-style SmartForm (fields labelled only by <label for>, opaque ids):");
    await withPage(browser, fixture("smartform.html"), async (page) => {
      const idVault = { ...VAULT, dateOfBirth: "01/15/1990", ssn: "123-45-6789" };
      const idJob = {
        autofillFields: Object.keys(idVault),
        identityFields: ["dateOfBirth", "ssn"],
        offer: {},
      };
      await driveSteps(page, idVault, idJob, opts(chooser([])));
      const v = await page.evaluate(() =>
        Object.fromEntries(
          ["q_0001", "q_0002", "q_0003", "q_0004", "q_0005", "q_0006", "q_0007", "q_0008", "q_0009", "q_0010", "q_0011"].map(
            (id) => [id, document.getElementById(id).value],
          ),
        ),
      );
      const events = await page.evaluate(() => window.__events);
      assert(v.q_0001 === "Jordan", "filled First Name via <label for>");
      assert(v.q_0002 === "Lee", "filled Middle Name via <label for>");
      assert(v.q_0003 === "Rivers", "filled Last Name via <label for>");
      assert(v.q_0004 === "jordan@example.com", "filled Email via a wrapping <label>");
      assert(v.q_0005 === "5551234567", "filled Phone via aria-labelledby");
      assert(v.q_0006 === "123 Peachtree St", "filled Street via <label for>");
      assert(v.q_0007 === "Atlanta", "filled City via <label for>");
      assert(v.q_0008 === "GA", "selected State <select> via <label for>");
      assert(v.q_0009 === "30303", "filled ZIP via <label for>");
      assert(v.q_0010 === "01/15/1990", "filled DOB via <label for>");
      assert(v.q_0011 === "123-45-6789", "filled masked SSN via <label for>");
      assert(!events.includes("identity:submit"), "STOPPED at identity (never submitted)");
    });

    console.log("Multi-URL flow (real page-to-page navigations, prefill re-runs each page):");
    await withPage(browser, fixture("multiurl1.html"), async (page) => {
      const idVault = { ...VAULT, dateOfBirth: "01/15/1990", ssn: "123-45-6789" };
      const idJob = {
        autofillFields: Object.keys(idVault),
        identityFields: ["dateOfBirth", "ssn"],
        offer: {},
      };
      const choose = chooser(["open now", "continue"]);
      const active = await driveSteps(page, idVault, idJob, opts(choose));
      const url = active.url();
      const params = new URL(url).searchParams;
      const vals = await active.evaluate(() => ({
        ssn: document.getElementById("ssn").value,
        dob: document.getElementById("dob").value,
      }));
      const events = await active.evaluate(() => window.__events);
      assert(url.includes("multiurl3.html"), "navigated across 3 real pages to the identity step");
      assert(
        params.get("fn") === "Jordan" && params.get("ci") === "Atlanta" && params.get("zp") === "30303",
        "prefill re-ran on page 2 (first name / city / ZIP carried into page 3)",
      );
      assert(vals.ssn === "123-45-6789" && vals.dob === "01/15/1990", "prefilled identity on the final page");
      assert(!events.includes("identity:submit"), "STOPPED at identity on the final page (never submitted)");
    });

    console.log("Split DOB (Month/Day selects + Year input) & masked SSN (type=password):");
    await withPage(browser, fixture("splitdob.html"), async (page) => {
      const idVault = { ...VAULT, dateOfBirth: "01/15/1990", ssn: "123-45-6789" };
      const idJob = {
        autofillFields: Object.keys(idVault),
        identityFields: ["dateOfBirth", "ssn"],
        offer: {},
      };
      await driveSteps(page, idVault, idJob, opts(chooser([])));
      const vals = await page.evaluate(() => ({
        m: document.getElementById("dob-m").value,
        d: document.getElementById("dob-d").value,
        y: document.getElementById("dob-y").value,
        ssn: document.getElementById("ssn").value,
      }));
      const events = await page.evaluate(() => window.__events);
      assert(vals.m === "01", "selected birth month (01) in the Month <select>");
      assert(vals.d === "15", "selected birth day (15) in the Day <select>");
      assert(vals.y === "1990", "filled birth year (1990) in the Year input");
      assert(vals.ssn === "123-45-6789", "filled masked (type=password) SSN input");
      assert(!events.includes("identity:submit"), "STOPPED — filled split DOB/masked SSN, never submitted");
    });

    console.log("Split SSN (3 inputs: area/group/serial):");
    await withPage(browser, fixture("ssnsplit.html"), async (page) => {
      const idVault = { ...VAULT, dateOfBirth: "01/15/1990", ssn: "123-45-6789" };
      const idJob = {
        autofillFields: Object.keys(idVault),
        identityFields: ["dateOfBirth", "ssn"],
        offer: {},
      };
      await driveSteps(page, idVault, idJob, opts(chooser([])));
      const vals = await page.evaluate(() => ({
        dob: document.getElementById("dob").value,
        s1: document.getElementById("ssn1").value,
        s2: document.getElementById("ssn2").value,
        s3: document.getElementById("ssn3").value,
      }));
      assert(vals.dob === "01/15/1990", "filled single MM/DD/YYYY DOB");
      assert(vals.s1 === "123" && vals.s2 === "45" && vals.s3 === "6789", "split SSN across the 3 inputs");
    });

    console.log("Identity autofill (SSN/DOB in the vault fill on the identity step, then STOP):");
    await withPage(browser, fixture("bmo.html"), async (page) => {
      // Vault the user opted into: identity values live on-device. The job lists
      // them in autofillFields (as buildAgentJob does) so prefill fills them.
      const idVault = { ...VAULT, dateOfBirth: "01/15/1990", ssn: "123-45-6789" };
      const idJob = {
        autofillFields: Object.keys(idVault),
        identityFields: ["dateOfBirth", "ssn"],
        offer: {},
      };
      const choose = chooser(["open now", "no, open a checking", "continue", "confirm"]);
      const active = await driveSteps(page, idVault, idJob, opts(choose));
      const vals = await active.evaluate(() => ({
        ssn: document.getElementById("ssn").value,
        dob: document.getElementById("dob").value,
      }));
      const events = await active.evaluate(() => window.__events);
      assert(vals.ssn === "123-45-6789", "pre-filled SSN from the local vault on the identity step");
      assert(vals.dob === "01/15/1990", "pre-filled DOB from the local vault on the identity step");
      assert(!events.includes("identity:submit"), "still STOPPED — filled identity but never submitted");
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
