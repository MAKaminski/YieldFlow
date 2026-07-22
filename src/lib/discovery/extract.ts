import Anthropic from "@anthropic-ai/sdk";
import type { DiscoveredOffer } from "./types";

// LLM extraction: turn a fetched offer-list page into structured
// DiscoveredOffer[]. Gated on ANTHROPIC_API_KEY — absent ⇒ returns [] so the
// curated snapshot remains the reliable baseline. Output is never auto-trusted:
// every offer carries an extractionConfidence + verificationStatus "llm_verified"
// and is link-verified downstream; only human_verified is fully trusted.

const MODEL = "claude-haiku-4-5-20251001"; // cheap, fast — fine for extraction

export function extractionEnabled(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

const OFFER_SCHEMA = {
  type: "object",
  properties: {
    offers: {
      type: "array",
      items: {
        type: "object",
        properties: {
          brandName: { type: "string" },
          legalName: { type: "string" },
          charterType: {
            type: "string",
            enum: ["national_bank", "state_bank", "credit_union", "thrift", "fintech_partner"],
          },
          productName: { type: "string" },
          productType: {
            type: "string",
            enum: ["checking", "savings", "money_market", "cd", "ira", "brokerage", "business_checking"],
          },
          title: { type: "string" },
          bonusType: {
            type: "string",
            enum: ["cash", "promo_apy", "points", "gift_card", "rate_boost"],
          },
          bonusAmountCents: { type: "integer", description: "cash bonus in integer cents" },
          requirementWindowDays: { type: "integer" },
          ddAmountCents: {
            type: "integer",
            description: "required cumulative direct deposit in cents, if any",
          },
          newCustomerRequired: { type: "boolean" },
          offerEndDate: { type: "string", description: "ISO date YYYY-MM-DD if stated" },
          confidence: { type: "number", description: "0..1 extraction confidence" },
        },
        required: ["brandName", "title", "bonusType", "confidence"],
      },
    },
  },
  required: ["offers"],
} as const;

interface RawOffer {
  brandName: string;
  legalName?: string;
  charterType?: DiscoveredOffer["charterType"];
  productName?: string;
  productType?: DiscoveredOffer["productType"];
  title: string;
  bonusType: DiscoveredOffer["bonusType"];
  bonusAmountCents?: number;
  requirementWindowDays?: number;
  ddAmountCents?: number;
  newCustomerRequired?: boolean;
  offerEndDate?: string;
  confidence: number;
}

/** Extract offers from a page's text. Returns [] when extraction is disabled. */
export async function extractOffers(
  text: string,
  sourceUrl: string,
): Promise<DiscoveredOffer[]> {
  if (!extractionEnabled()) return [];

  const client = new Anthropic();
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    tools: [
      {
        name: "emit_offers",
        description: "Return the US consumer bank sign-up bonus offers found on this page.",
        input_schema: OFFER_SCHEMA as unknown as Anthropic.Tool.InputSchema,
      },
    ],
    tool_choice: { type: "tool", name: "emit_offers" },
    messages: [
      {
        role: "user",
        content:
          "Extract every US consumer bank account sign-up bonus from the page text below. " +
          "Only real, currently-listed offers with a cash bonus or promo APY. Money in integer cents. " +
          "Be conservative with confidence when terms are unclear.\n\n" +
          text.slice(0, 24_000),
      },
    ],
  });

  const toolUse = msg.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") return [];
  const raw = (toolUse.input as { offers?: RawOffer[] }).offers ?? [];

  return raw.map((r): DiscoveredOffer => {
    const requirements: DiscoveredOffer["requirements"] = r.ddAmountCents
      ? [
          {
            requirementType: "direct_deposit_cumulative",
            targetAmountCents: r.ddAmountCents,
            windowDays: r.requirementWindowDays ?? 90,
            depositSourceConstraint: "any_ach",
            verificationDifficulty: "probabilistic",
            confidenceNotes: "Extracted automatically — confirm the DD rules at the source.",
          },
        ]
      : [];
    return {
      brandName: r.brandName,
      legalName: r.legalName ?? r.brandName,
      charterType: r.charterType ?? "national_bank",
      productName: r.productName ?? `${r.brandName} Checking`,
      productType: r.productType ?? "checking",
      title: r.title,
      bonusType: r.bonusType,
      bonusAmountCents: r.bonusAmountCents,
      requirementWindowDays: r.requirementWindowDays,
      newCustomerRequired: r.newCustomerRequired ?? true,
      offerEndDate: r.offerEndDate,
      termsUrl: sourceUrl,
      sourceUrl,
      extractionConfidence: Math.max(0, Math.min(1, r.confidence ?? 0.4)),
      verificationStatus: "llm_verified",
      applicationChannel: "web",
      requirements,
    };
  });
}
