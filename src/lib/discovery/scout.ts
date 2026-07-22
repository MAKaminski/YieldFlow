import { existsSync, readdirSync } from "node:fs";
import { chromium } from "playwright-core";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";

// The preview scout: a REAL headless browser visits each web application page,
// records whether it's a live signup form, and captures the fields the user
// will face (+ a small screenshot). It does NOT open accounts or submit
// anything — preview + field-map only, stopping at the identity/KYC wall.
//
// Reality check baked in: many banks block headless/datacenter browsers, so a
// `blocked` result is expected, not a bug — the cockpit falls back to the
// verified link + instructions in that case. Runs offline (npm run db:scout),
// never in the serverless runtime.

const BOT_WALL_RE =
  /captcha|are you a robot|verify you are human|access denied|incapsula|imperva|pardon the interruption|unusual traffic|request blocked|denied/i;

/** Find the pre-installed Chromium binary (image build number varies). */
function resolveChromium(): string | undefined {
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers";
  if (!existsSync(base)) return undefined;
  const dirs = readdirSync(base).filter((d) => d.startsWith("chromium-"));
  for (const d of dirs) {
    const p = `${base}/${d}/chrome-linux/chrome`;
    if (existsSync(p)) return p;
  }
  return undefined;
}

export interface ScoutResult {
  scouted: number;
  captured: number;
  blocked: number;
  error: number;
}

export async function scoutApplicationPages(): Promise<ScoutResult> {
  const offers = await db
    .select({
      id: schema.offer.id,
      title: schema.offer.title,
      url: schema.offer.applicationUrl,
      channel: schema.offer.applicationChannel,
    })
    .from(schema.offer)
    .where(eq(schema.offer.status, "active"));

  const web = offers.filter((o) => o.channel === "web" && o.url);
  const result: ScoutResult = { scouted: 0, captured: 0, blocked: 0, error: 0 };

  const executablePath = resolveChromium();
  const browser = await chromium.launch({
    headless: true,
    executablePath,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
    proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined,
  });

  for (const o of web) {
    result.scouted++;
    let status: "captured" | "blocked" | "error" = "error";
    let fields: string[] | null = null;
    let screenshot: string | null = null;

    const ctx = await browser.newContext({
      ignoreHTTPSErrors: true,
      viewport: { width: 900, height: 700 },
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
    });
    const page = await ctx.newPage();
    try {
      await page.goto(o.url!, { waitUntil: "domcontentloaded", timeout: 20_000 });
      await page.waitForTimeout(2500);
      const html = await page.content();
      if (BOT_WALL_RE.test(html) || html.length < 1500) {
        status = "blocked";
      } else {
        // Observed field labels the user will fill (best-effort).
        fields = await page.evaluate(() => {
          const out: string[] = [];
          const inputs = Array.from(
            document.querySelectorAll("input, select"),
          ).slice(0, 40) as (HTMLInputElement | HTMLSelectElement)[];
          for (const el of inputs) {
            const t = (el as HTMLInputElement).type;
            if (t === "hidden" || t === "submit" || t === "button") continue;
            const rect = el.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) continue;
            let label = el.getAttribute("aria-label") || "";
            if (!label && el.id) {
              const l = document.querySelector(`label[for="${el.id}"]`);
              if (l) label = l.textContent || "";
            }
            if (!label) label = (el as HTMLInputElement).placeholder || "";
            if (!label) label = el.getAttribute("name") || "";
            label = label.trim().replace(/\s+/g, " ").slice(0, 40);
            if (label && !out.includes(label)) out.push(label);
            if (out.length >= 12) break;
          }
          return out;
        });
        const buf = await page.screenshot({ type: "jpeg", quality: 38 });
        screenshot = "data:image/jpeg;base64," + buf.toString("base64");
        status = fields && fields.length > 0 ? "captured" : "blocked";
      }
    } catch (err) {
      const msg = String(err);
      // Connection resets / timeouts are the bank blocking automation.
      status = /ERR_CONNECTION|timeout|ERR_|net::/i.test(msg) ? "blocked" : "error";
    } finally {
      await ctx.close();
    }

    if (status === "captured") result.captured++;
    else if (status === "blocked") result.blocked++;
    else result.error++;

    await db
      .update(schema.offer)
      .set({
        scoutStatus: status,
        scoutFields: fields,
        // Keep the row small — only store a screenshot when it's reasonably sized.
        scoutScreenshot: screenshot && screenshot.length < 200_000 ? screenshot : null,
        scoutedAt: new Date(),
      })
      .where(eq(schema.offer.id, o.id));

    console.log(
      `  ${status.padEnd(8)} ${o.title}${fields?.length ? ` — fields: ${fields.join(", ")}` : ""}`,
    );
  }

  await browser.close();
  return result;
}
