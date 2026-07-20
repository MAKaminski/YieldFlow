import type { IngestSourceMeta } from "./types";

// Public offer-list sources the live provider fetches + LLM-extracts. These are
// aggregator/tracker pages and bank offer indexes that respond normally to a
// plain fetch — NOT bank application pages (which block bots). Keep the list
// small and the crawl frequency low; we retain each offer's source link for
// attribution.

export interface DiscoverySource extends IngestSourceMeta {
  url: string;
}

export const DISCOVERY_SOURCES: DiscoverySource[] = [
  {
    sourceName: "Doctor of Credit — best bank bonuses",
    url: "https://www.doctorofcredit.com/best-bank-account-bonuses/",
    sourceType: "aggregator",
    trustScore: 0.9,
  },
  {
    sourceName: "NerdWallet — best bank bonuses",
    url: "https://www.nerdwallet.com/banking/best/bank-bonuses-and-promotions",
    sourceType: "aggregator",
    trustScore: 0.85,
  },
  {
    sourceName: "Bankrate — best bank bonuses",
    url: "https://www.bankrate.com/banking/best-bank-account-bonuses-and-promotions/",
    sourceType: "aggregator",
    trustScore: 0.85,
  },
  {
    sourceName: "CNBC Select — best checking bonuses",
    url: "https://www.cnbc.com/select/best-checking-account-bonuses/",
    sourceType: "aggregator",
    trustScore: 0.8,
  },
];
