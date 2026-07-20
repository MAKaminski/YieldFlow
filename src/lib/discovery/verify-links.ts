import { eq } from "drizzle-orm";
import { db, schema } from "@/db";

// Auto-validates each offer's application link so the campaign cockpit never
// deep-links to a dead page. App-store links (app-only banks) validate by
// pattern; web links are fetched and must resolve (HTTP < 400). Results are
// written to offer.application_url_verified. Heuristic, not a guarantee — a page
// can resolve and still gate — but it catches the "click goes nowhere" case.

const APP_STORE_RE = /apps\.apple\.com|play\.google\.com/i;

async function urlResolves(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers: {
        // Some bank sites 403 bare clients; present a browser-like UA.
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
        accept: "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(12_000),
    });
    return res.status < 400;
  } catch {
    return false;
  }
}

export interface VerifyResult {
  checked: number;
  verified: number;
  failed: { title: string; url: string | null }[];
}

/** Verify application links for all active offers; write the result to the DB. */
export async function verifyApplicationLinks(): Promise<VerifyResult> {
  const offers = await db
    .select({
      id: schema.offer.id,
      title: schema.offer.title,
      applicationUrl: schema.offer.applicationUrl,
      applicationChannel: schema.offer.applicationChannel,
    })
    .from(schema.offer)
    .where(eq(schema.offer.status, "active"));

  let verified = 0;
  const failed: { title: string; url: string | null }[] = [];

  for (const o of offers) {
    const url = o.applicationUrl;
    let ok = false;
    if (url) {
      ok =
        o.applicationChannel === "app"
          ? APP_STORE_RE.test(url) || (await urlResolves(url))
          : await urlResolves(url);
    }
    if (ok) verified++;
    else failed.push({ title: o.title, url: url ?? null });

    await db
      .update(schema.offer)
      .set({ applicationUrlVerified: ok })
      .where(eq(schema.offer.id, o.id));
  }

  return { checked: offers.length, verified, failed };
}
