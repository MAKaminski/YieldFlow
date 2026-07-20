import type { DiscoveredOffer } from "./types";
import { CURATED_OFFERS } from "@/db/discovery-data";

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

/**
 * Live crawl seam — NOT built yet. It would:
 *   1. fetch aggregator pages (Doctor of Credit, NerdWallet, Bankrate) + bank
 *      offer pages,
 *   2. store raw HTML/OCR as offer_raw_document,
 *   3. LLM-extract each into DiscoveredOffer (needs ANTHROPIC_API_KEY),
 *   4. hand off to ingestOffers().
 * Kept as a documented interface so the ingest pipeline is source-agnostic.
 */
export const liveWebProvider: OfferProvider = {
  name: "live-web-crawler",
  async fetch() {
    throw new Error(
      "liveWebProvider not implemented — requires ANTHROPIC_API_KEY and a crawl budget. " +
        "Use curatedProvider for now.",
    );
  },
};
