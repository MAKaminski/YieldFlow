// The normalized shape a discovery provider emits. Mirrors the Domain B/C
// schema but flattened so a provider (curated dataset now, live crawler later)
// can describe an offer without touching Drizzle. `ingestOffers` maps this onto
// institution / product / offer / requirement_group / requirement / disqualifier
// / geo_eligibility rows.

export type CharterType =
  | "national_bank"
  | "state_bank"
  | "credit_union"
  | "thrift"
  | "fintech_partner";

export type ProductType =
  | "checking"
  | "savings"
  | "money_market"
  | "cd"
  | "ira"
  | "brokerage"
  | "business_checking";

export type BonusType = "cash" | "promo_apy" | "points" | "gift_card" | "rate_boost";

export type RequirementType =
  | "direct_deposit_cumulative"
  | "direct_deposit_per_period"
  | "min_balance_avg_daily"
  | "min_balance_point_in_time"
  | "new_money_deposit"
  | "debit_transactions_count"
  | "bill_pay_count"
  | "enroll_online_banking"
  | "enroll_estatements"
  | "maintain_days"
  | "no_early_closure"
  | "branch_visit"
  | "promo_code_entry";

export type DepositSourceConstraint =
  | "any_ach"
  | "payroll_ach"
  | "govt_benefit_ach"
  | "external_transfer_ok"
  | "no_internal_transfer";

export type VerificationDifficulty = "deterministic" | "probabilistic" | "opaque";

export type DisqualifierType =
  | "existing_customer"
  | "closed_account_lookback"
  | "prior_bonus_lookback"
  | "state_excluded"
  | "employee_of_bank"
  | "business_entity"
  | "age_minimum"
  | "ssn_itin_required"
  | "tax_withholding_status";

export interface DiscoveredRequirement {
  requirementType: RequirementType;
  targetAmountCents?: number;
  targetCount?: number;
  windowDays?: number;
  windowStartAnchor?: "account_open" | "offer_start" | "first_deposit" | "statement_cycle";
  depositSourceConstraint?: DepositSourceConstraint;
  isBonusGating?: boolean; // default true
  verificationDifficulty?: VerificationDifficulty; // default deterministic
  confidenceNotes?: string;
}

export interface DiscoveredDisqualifier {
  disqualifierType: DisqualifierType;
  lookbackMonths?: number;
  excludedStates?: string[];
  includedStatesOnly?: string[];
  detail?: string;
}

export interface DiscoveredOffer {
  // Institution
  brandName: string;
  legalName: string;
  charterType: CharterType;
  hqState?: string;
  footprintStates?: string[]; // branch states; omit for online-national
  chexsystemsSensitivity?: "none" | "moderate" | "strict" | "unknown";
  earlyClosureClawbackDays?: number;

  // Product
  productName: string;
  productType: ProductType;
  monthlyFeeCents?: number;
  minOpeningDepositCents?: number;
  standardApyBps?: number;
  accountOpeningUrl?: string;

  // Offer
  title: string;
  offerCode?: string;
  bonusType: BonusType;
  bonusAmountCents?: number;
  bonusApyBps?: number;
  offerEndDate?: string; // ISO date (open-by)
  requirementWindowDays?: number;
  payoutWindowDays?: number;
  isTargeted?: boolean;
  newCustomerRequired?: boolean;
  newMoneyRequired?: boolean;
  customerLookbackMonths?: number;
  termsUrl?: string;
  sourceUrl: string;
  extractionConfidence: number; // 0..1
  verificationStatus?: "unverified" | "llm_verified" | "human_verified" | "disputed";

  // How the user actually applies — drives the cockpit's step-1 deep link.
  applicationUrl?: string; // precise apply/offer page, or app-store URL for app-only
  applicationChannel?: "web" | "app" | "branch" | "phone";
  signupNotes?: string; // bank-specific gotcha, especially what counts as DD

  // Requirement tree (flattened into one ALL group) + gates
  requirements: DiscoveredRequirement[];
  disqualifiers?: DiscoveredDisqualifier[];
  /** States where the offer is eligible. Omit for nationwide. */
  geoEligibleStates?: string[];
  /** States explicitly excluded (written as geo ineligible + a disqualifier). */
  geoExcludedStates?: string[];
}

export interface IngestSourceMeta {
  sourceType:
    | "direct_mail"
    | "bank_website"
    | "aggregator"
    | "affiliate_feed"
    | "email"
    | "reddit"
    | "rss";
  sourceName: string;
  baseUrl?: string;
  trustScore?: number;
}

export interface IngestResult {
  runId: string;
  offersFound: number;
  offersNew: number;
  offersUpdated: number;
  skipped: number;
}
