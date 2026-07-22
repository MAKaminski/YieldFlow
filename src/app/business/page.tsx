import Link from "next/link";
import { notFound } from "next/navigation";
import { getRankedOffers } from "@/lib/queries";
import { bpsToPercentString, centsToUsd, offerDurations } from "@/lib/yield";
import { isFlagEnabled } from "@/lib/flags";

export const dynamic = "force-dynamic";

export default async function BusinessPage() {
  // Hard gate: even by direct URL, /business 404s unless the flag is on.
  if (!(await isFlagEnabled("business_accounts"))) notFound();

  const offers = (await getRankedOffers()).filter(
    (o) => o.offer.audience === "business",
  );
  const eligibleCash = offers.filter(
    (o) =>
      o.eligibility?.eligibilityStatus === "eligible" &&
      o.offer.bonusType === "cash" &&
      (o.offer.bonusAmountCents ?? 0) > 0,
  );
  const totalExpected = eligibleCash.reduce(
    (s, o) => s + (o.eligibility?.expectedGrossBonusCents ?? 0),
    0,
  );
  const totalCapital = eligibleCash.reduce(
    (s, o) => s + (o.eligibility?.requiredCapitalCents ?? 0),
    0,
  );

  return (
    <div className="space-y-8">
      <section>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">Business accounts</h1>
          <span className="rounded bg-accent/15 px-2 py-0.5 text-[10px] uppercase tracking-widest text-accent">
            beta
          </span>
        </div>
        <p className="mt-1 max-w-2xl text-sm text-mute">
          Business checking bonuses pay far more than consumer ones — often $300–$1,000+ — which is
          where the yield really compounds. They require a one-time <b>KYB payload</b> (EIN, entity
          type, formation date/state) that stays on your device, just like your personal details.
        </p>
      </section>

      <section className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label={`Eligible bonuses (${eligibleCash.length})`} value={centsToUsd(totalExpected)} />
        <Stat label="Capital to earn them" value={centsToUsd(totalCapital)} />
        <Stat
          label="Bonus ÷ capital"
          value={totalCapital > 0 ? `${((totalExpected / totalCapital) * 100).toFixed(1)}%` : "—"}
          accent
        />
        <Stat
          label="Top annualized"
          value={bpsToPercentString(eligibleCash[0]?.eligibility?.projectedAnnualizedYieldBps ?? 0)}
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
                    <span className="rounded bg-edge/60 px-2 py-0.5 text-[10px] uppercase tracking-wide text-mute">
                      business
                    </span>
                    {!isEligible && (
                      <span className="rounded bg-danger/15 px-2 py-0.5 text-[10px] uppercase tracking-wide text-danger">
                        {eligibility?.eligibilityStatus === "needs_review" ? "needs review" : "not eligible"}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-mute">
                    {institution.brandName}
                    {product ? ` · ${product.productName}` : ""}
                    {offer.offerEndDate ? ` · open by ${fmtDate(offer.offerEndDate)}` : ""}
                  </p>
                  <p className="text-xs text-mute">
                    ⏱ bonus in up to {toBonusDays}d · keep open ~{holdDays}d before closing (clawback)
                  </p>
                </div>
                <div className="flex gap-6 text-right">
                  <Metric
                    label="Reward"
                    value={
                      offer.bonusType === "cash" && offer.bonusAmountCents
                        ? centsToUsd(offer.bonusAmountCents)
                        : "—"
                    }
                  />
                  <Metric
                    label="Capital"
                    value={eligibility?.requiredCapitalCents ? centsToUsd(eligibility.requiredCapitalCents) : "—"}
                  />
                  <Metric
                    label="Annualized"
                    value={bpsToPercentString(eligibility?.projectedAnnualizedYieldBps ?? 0)}
                    accent
                  />
                </div>
              </div>
            </Link>
          );
        })}
        {offers.length === 0 && (
          <p className="rounded-xl border border-edge/70 bg-panel/60 p-6 text-sm text-mute">
            No business offers loaded. Run <code className="text-accent">npm run db:discover</code>.
          </p>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-xl border border-edge/70 bg-panel/60 p-4">
      <div className="text-xs uppercase tracking-wide text-mute">{label}</div>
      <div className={`mt-1 text-xl font-semibold ${accent ? "text-accent" : ""}`}>{value}</div>
    </div>
  );
}

function Metric({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-mute">{label}</div>
      <div className={`text-sm font-semibold ${accent ? "text-accent" : ""}`}>{value}</div>
    </div>
  );
}

function fmtDate(d: Date) {
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
