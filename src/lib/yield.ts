/**
 * YieldFlow core economics.
 *
 * The product thesis: a bank sign-up bonus is a *fixed dollar amount* decoupled
 * from balance, so the return is inversely proportional to how much capital you
 * tie up and for how long. The optimizer's objective is therefore not "highest
 * bonus" but "most bonus dollars per capital-day, subject to constraints."
 *
 * Everything here is pure TypeScript (no DB, no side effects) so it can be
 * reused by the seed, the dashboard, the API, and unit tests alike. All money
 * is handled in integer cents; basis points (bps) are used for rates
 * (1% = 100 bps, so 10% = 1000 bps).
 */

export const BPS_PER_UNIT = 10_000;
const DAYS_PER_YEAR = 365;

/** capital_days = capital (in cents) × hold period (in days). The scarce resource. */
export function capitalDays(capitalCents: number, holdDays: number): number {
  return capitalCents * holdDays;
}

export interface YieldInputs {
  /** Fixed cash bonus, in cents. */
  bonusCents: number;
  /** Promo/standard interest earned over the hold period, in cents. */
  interestCents?: number;
  /** Fees paid over the hold period (e.g. unwaived monthly fee), in cents. */
  feesCents?: number;
  /** Capital tied up to satisfy the offer, in cents. */
  capitalCents: number;
  /** Days the capital is committed. */
  holdDays: number;
}

/** Net gain in cents = bonus + interest − fees. */
export function netGainCents({
  bonusCents,
  interestCents = 0,
  feesCents = 0,
}: YieldInputs): number {
  return bonusCents + interestCents - feesCents;
}

/**
 * Annualized yield in basis points.
 *
 *   annualized = (netGain / capital) × (365 / holdDays)
 *
 * Returns 0 when capital or hold period is non-positive (e.g. a fee-waiver-only
 * scenario with effectively zero capital is treated as unbounded elsewhere).
 */
export function projectedAnnualizedYieldBps(inputs: YieldInputs): number {
  const { capitalCents, holdDays } = inputs;
  if (capitalCents <= 0 || holdDays <= 0) return 0;
  const periodReturn = netGainCents(inputs) / capitalCents;
  const annualized = periodReturn * (DAYS_PER_YEAR / holdDays);
  return Math.round(annualized * BPS_PER_UNIT);
}

/**
 * After-tax annualized yield. Bank bonuses are taxable interest income (1099-INT),
 * so the taxable portion is reduced by the marginal rate. Interest is likewise
 * taxable; only fees are already after-tax.
 */
export function projectedNetAfterTaxBps(
  grossAnnualizedBps: number,
  marginalRateBps: number,
): number {
  const keepFraction = 1 - marginalRateBps / BPS_PER_UNIT;
  return Math.round(grossAnnualizedBps * keepFraction);
}

export interface FeasibilityInputs {
  /**
   * How hard the hardest gating requirement is to verify. Direct-deposit
   * recognition is the usual killer — banks reserve discretion on ACH coding.
   */
  ddDifficulty: "deterministic" | "probabilistic" | "opaque";
  /** Prior observed outcomes for similar offers: [successes, attempts]. */
  priorOutcomes?: { successes: number; attempts: number };
}

/**
 * Probability the campaign actually pays out, in [0, 1]. Starts from a base
 * rate keyed off the hardest requirement's verifiability, then blends in any
 * observed history (Laplace-smoothed).
 */
export function feasibilityScore({
  ddDifficulty,
  priorOutcomes,
}: FeasibilityInputs): number {
  const base =
    ddDifficulty === "deterministic"
      ? 0.95
      : ddDifficulty === "probabilistic"
        ? 0.75
        : 0.5;

  if (!priorOutcomes || priorOutcomes.attempts === 0) return round3(base);

  // Laplace smoothing toward the base rate.
  const { successes, attempts } = priorOutcomes;
  const smoothed = (successes + base * 2) / (attempts + 2);
  return round3(smoothed);
}

export interface RankInputs extends YieldInputs {
  feasibility: number; // 0..1
  marginalRateBps?: number;
}

/**
 * The optimizer's ranking objective. Higher is better. We rank on
 * risk-adjusted after-tax annualized yield — i.e. expected value per
 * capital-day — so a smaller, faster, more-certain bonus can outrank a larger
 * one that ties up more capital for longer or is likely to fail.
 */
export function rankScore(inputs: RankInputs): number {
  const gross = projectedAnnualizedYieldBps(inputs);
  const afterTax = projectedNetAfterTaxBps(gross, inputs.marginalRateBps ?? 0);
  return Math.round(afterTax * inputs.feasibility);
}

/** Convenience: compute the whole eligibility economics bundle in one call. */
export function computeEconomics(
  inputs: YieldInputs & { marginalRateBps?: number; feasibility?: number },
) {
  const grossBps = projectedAnnualizedYieldBps(inputs);
  const netAfterTaxBps = projectedNetAfterTaxBps(
    grossBps,
    inputs.marginalRateBps ?? 0,
  );
  const feasibility = inputs.feasibility ?? 1;
  return {
    netGainCents: netGainCents(inputs),
    capitalDays: capitalDays(inputs.capitalCents, inputs.holdDays),
    projectedAnnualizedYieldBps: grossBps,
    projectedNetAfterTaxBps: netAfterTaxBps,
    rankScore: rankScore({ ...inputs, feasibility }),
  };
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** Format a bps value as a human percentage string, e.g. 10700 -> "107.0%". */
export function bpsToPercentString(bps: number, digits = 1): string {
  return `${(bps / 100).toFixed(digits)}%`;
}

/** Format integer cents as USD, e.g. 40000 -> "$400.00". */
export function centsToUsd(cents: number): string {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}
