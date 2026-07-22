import type { DiscoveredOffer } from "./types";
import { CURATED_OFFERS } from "@/db/discovery-data";
import { DISCOVERY_SOURCES } from "./sources";
import { extractOffers, extractionEnabled } from "./extract";

// An OfferProvider yields normalized offers from some source. Today the curated
// provider returns a hand-verified snapshot of live public offers; a future
// liveWebProvider would fetch trackers/bank pages and LLM-extract to the same
// shape (see stub below).

export interface OfferProvider {
  name: string;
  fetch(): Promise<DiscoveredOffer[]>;
}

export const curatedProvider: OfferProvider = {
  name: "curated-public-offers",
  async fetch() {
    return CURATED_OFFERS;
  },
};

/** Strip tags/scripts to plain text for the extractor. */
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Live discovery: fetch the public offer-list sources and LLM-extract offers
 * into DiscoveredOffer[]. Only aggregator/offer-list pages (they respond to a
 * plain fetch) — never bank application pages. Returns [] when
 * ANTHROPIC_API_KEY is unset, so curated stays the baseline.
 */
export const liveWebProvider: OfferProvider = {
  name: "live-web-extractor",
  async fetch() {
    if (!extractionEnabled()) {
      console.log("  live discovery skipped (no ANTHROPIC_API_KEY)");
      return [];
    }
    const all: DiscoveredOffer[] = [];
    for (const src of DISCOVERY_SOURCES) {
      try {
        const res = await fetch(src.url, {
          headers: {
            "user-agent":
              "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
            accept: "text/html",
          },
          signal: AbortSignal.timeout(20_000),
        });
        if (!res.ok) {
          console.log(`  live fetch ${res.status}: ${src.sourceName}`);
          continue;
        }
        const text = htmlToText(await res.text());
        const offers = await extractOffers(text, src.url);
        console.log(`  live extracted ${offers.length} from ${src.sourceName}`);
        all.push(...offers);
      } catch (err) {
        console.log(`  live fetch failed: ${src.sourceName} — ${String(err).slice(0, 80)}`);
      }
    }
    return all;
  },
};
