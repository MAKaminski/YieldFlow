import Link from "next/link";
import { getRankedOffers } from "@/lib/queries";
import { bpsToPercentString, centsToUsd, offerDurations } from "@/lib/yield";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const offers = await getRankedOffers();

  const eligible = offers.filter(
    (o) => o.eligibility?.eligibilityStatus === "eligible",
  );
  // Aggregates cover eligible CASH-bonus offers only — a $0-bonus rate promo
  // (e.g. a money-market APY) would otherwise inflate "required capital" against
  // no bonus and make the numbers read wrong.
  const eligibleCash = eligible.filter(
    (o) => o.offer.bonusType === "cash" && (o.offer.bonusAmountCents ?? 0) > 0,
  );
  const totalExpected = eligibleCash.reduce(
    (sum, o) => sum + (o.eligibility?.expectedGrossBonusCents ?? 0),
    0,
  );
  const totalCapital = eligibleCash.reduce(
    (sum, o) => sum + (o.eligibility?.requiredCapitalCents ?? 0),
    0,
  );

  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-2xl font-semibold tracking-tight">Offer pipeline</h1>
        <p className="mt-1 max-w-2xl text-sm text-mute">
          Ranked by risk-adjusted after-tax annualized yield — i.e. the most bonus
          dollars per capital-day. A fixed cash bonus on little capital held briefly
          beats a bigger one that ties up more for longer.
        </p>
      </section>

      <section className="grid grid-cols-2 gap-4 sm:grid-cols-5">
        <Stat label={`Eligible bonuses (${eligibleCash.length})`} value={centsToUsd(totalExpected)} />
        <Stat label="Capital to earn them" value={centsToUsd(totalCapital)} />
        <Stat
          label="Bonus ÷ capital"
          value={totalCapital > 0 ? `${((totalExpected / totalCapital) * 100).toFixed(1)}%` : "—"}
          accent
        />
        <Stat
          label="Top annualized"
          value={bpsToPercentString(
            eligibleCash[0]?.eligibility?.projectedAnnualizedYieldBps ?? 0,
          )}
        />
        <Stat
          label="Top after-tax"
          value={bpsToPercentString(
            eligibleCash[0]?.eligibility?.projectedNetAfterTaxBps ?? 0,
          )}
        />
      </section>

      <section className="space-y-3">
        {offers.map(({ offer, institution, product, eligibility }, i) => {
          const isEligible = eligibility?.eligibilityStatus === "eligible";
          const { toBonusDays, holdDays } = offerDurations(offer, institution);
          return (
          <Link
            key={offer.id}
            href={`/offers/${offer.id}`}
            className={`block rounded-xl border border-edge/70 bg-panel/60 p-5 transition hover:border-accent/60 hover:bg-panel ${
              isEligible ? "" : "opacity-60"
            }`}
          >
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-mute">#{i + 1}</span>
                  <h2 className="text-lg font-medium">{offer.title}</h2>
                  {offer.isTargeted && (
                    <span className="rounded bg-warn/15 px-2 py-0.5 text-[10px] uppercase tracking-wide text-warn">
                      targeted
                    </span>
                  )}
                  {!isEligible && (
                    <span className="rounded bg-danger/15 px-2 py-0.5 text-[10px] uppercase tracking-wide text-danger">
                      {eligibility?.eligibilityStatus === "needs_review"
                        ? "needs review"
                        : "not eligible"}
                    </span>
                  )}
                </div>
                <p className="text-sm text-mute">
                  {institution.brandName}
                  {product ? ` · ${product.productName}` : ""}
                  {offer.offerEndDate
                    ? ` · open by ${fmtDate(offer.offerEndDate)}`
                    : ""}
                </p>
                <p className="text-xs text-mute">
                  ⏱ bonus in up to {toBonusDays}d · keep open ~{holdDays}d before
                  closing (clawback)
                </p>
              </div>

              <div className="flex gap-6 text-right">
                <Metric
                  label="Reward"
                  value={
                    offer.bonusType === "cash" && offer.bonusAmountCents
                      ? centsToUsd(offer.bonusAmountCents)
                      : offer.bonusApyBps
                        ? bpsToPercentString(offer.bonusApyBps, 2) + " APY"
                        : "—"
                  }
                />
                <Metric
                  label="Capital"
                  value={
                    eligibility?.requiredCapitalCents
                      ? centsToUsd(eligibility.requiredCapitalCents)
                      : "—"
                  }
                />
                <Metric
                  label="Annualized"
                  value={bpsToPercentString(
                    eligibility?.projectedAnnualizedYieldBps ?? 0,
                  )}
                  accent
                />
                <Metric
                  label="Feasibility"
                  value={
                    eligibility?.feasibilityScore != null
                      ? `${Math.round(eligibility.feasibilityScore * 100)}%`
                      : "—"
                  }
                />
              </div>
            </div>
          </Link>
          );
        })}
        {offers.length === 0 && (
          <p className="rounded-xl border border-edge/70 bg-panel/60 p-6 text-sm text-mute">
            No offers yet. Run <code className="text-accent">npm run db:seed</code>.
          </p>
        )}
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-xl border border-edge/70 bg-panel/60 p-4">
      <div className="text-xs uppercase tracking-wide text-mute">{label}</div>
      <div
        className={`mt-1 text-xl font-semibold ${accent ? "text-accent" : ""}`}
      >
        {value}
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-mute">{label}</div>
      <div className={`text-sm font-semibold ${accent ? "text-accent" : ""}`}>
        {value}
      </div>
    </div>
  );
}

function fmtDate(d: Date) {
  return new Date(d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
