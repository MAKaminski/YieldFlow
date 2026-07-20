import Link from "next/link";
import { notFound } from "next/navigation";
import { getOfferDetail } from "@/lib/queries";
import { bpsToPercentString, centsToUsd } from "@/lib/yield";
import { startCampaignAction } from "@/app/campaigns/actions";

export const dynamic = "force-dynamic";

const DIFFICULTY_COLOR: Record<string, string> = {
  deterministic: "text-accent",
  probabilistic: "text-warn",
  opaque: "text-danger",
};

export default async function OfferDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const detail = await getOfferDetail(id);
  if (!detail) notFound();

  const { offer, institution, product, eligibility, groupedRequirements, disqualifiers, geo } =
    detail;

  return (
    <div className="space-y-8">
      <div>
        <Link href="/" className="text-sm text-mute hover:text-slate-100">
          ← All offers
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{offer.title}</h1>
            <p className="mt-1 text-sm text-mute">
              {institution.legalName}
              {product ? ` · ${product.productName}` : ""} · code {offer.offerCode ?? "—"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {(offer.applicationUrl || offer.termsUrl) && (
              <a
                href={`/go/${offer.id}`}
                target="_blank"
                rel="noreferrer"
                className="rounded-lg border border-edge/60 px-4 py-2.5 text-sm text-slate-200 hover:border-accent/60"
              >
                Open application ↗
              </a>
            )}
            {eligibility?.eligibilityStatus === "ineligible" ? (
              <span className="rounded-lg border border-edge/60 bg-panel/60 px-4 py-2 text-sm text-mute">
                Not eligible for this profile
              </span>
            ) : (
              <form action={startCampaignAction.bind(null, offer.id)}>
                <button
                  type="submit"
                  className="rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-ink hover:bg-accent/90"
                >
                  Start campaign →
                </button>
              </form>
            )}
          </div>
        </div>
      </div>

      {/* Economics */}
      <section className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat
          label="Reward"
          value={
            offer.bonusType === "cash" && offer.bonusAmountCents
              ? centsToUsd(offer.bonusAmountCents)
              : offer.bonusApyBps
                ? bpsToPercentString(offer.bonusApyBps, 2) + " APY"
                : "—"
          }
        />
        <Stat
          label="Capital required"
          value={
            eligibility?.requiredCapitalCents
              ? centsToUsd(eligibility.requiredCapitalCents)
              : "—"
          }
        />
        <Stat
          label="Annualized"
          value={bpsToPercentString(eligibility?.projectedAnnualizedYieldBps ?? 0)}
          accent
        />
        <Stat
          label="After tax"
          value={bpsToPercentString(eligibility?.projectedNetAfterTaxBps ?? 0)}
        />
      </section>

      {/* Requirement tree */}
      <section className="space-y-4">
        <h2 className="text-lg font-medium">Requirements</h2>
        {groupedRequirements.map(({ group, requirements }) => (
          <div
            key={group.id}
            className="rounded-xl border border-edge/70 bg-panel/60 p-5"
          >
            <div className="mb-3 flex items-center gap-2">
              <span className="rounded bg-edge px-2 py-0.5 text-xs font-semibold tracking-wide">
                {group.logicOperator}
                {group.logicOperator === "N_OF" && group.nRequired
                  ? ` ${group.nRequired}`
                  : ""}
              </span>
              <span className="text-sm text-mute">{group.description}</span>
            </div>
            <ul className="space-y-3">
              {requirements.map((r) => (
                <li
                  key={r.id}
                  className="rounded-lg border border-edge/50 bg-ink/40 p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-mono text-sm">{r.requirementType}</span>
                    <div className="flex items-center gap-3 text-xs">
                      {!r.isBonusGating && (
                        <span className="rounded bg-edge/70 px-2 py-0.5 text-mute">
                          fee-waiver only
                        </span>
                      )}
                      <span
                        className={DIFFICULTY_COLOR[r.verificationDifficulty] ?? ""}
                      >
                        {r.verificationDifficulty}
                      </span>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-xs text-mute">
                    {r.targetAmountCents != null && (
                      <span>target {centsToUsd(r.targetAmountCents)}</span>
                    )}
                    {r.targetCount != null && <span>×{r.targetCount}</span>}
                    {r.windowDays != null && (
                      <span>
                        {r.windowDays}d from {r.windowStartAnchor}
                      </span>
                    )}
                    {r.depositSourceConstraint && (
                      <span>source: {r.depositSourceConstraint}</span>
                    )}
                    {r.balanceMeasure && <span>{r.balanceMeasure}</span>}
                  </div>
                  {r.confidenceNotes && (
                    <p className="mt-2 text-xs italic text-mute">
                      {r.confidenceNotes}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
        {groupedRequirements.length === 0 && (
          <p className="text-sm text-mute">No requirement tree modeled yet.</p>
        )}
      </section>

      {/* Disqualifiers + geo */}
      <section className="grid gap-6 sm:grid-cols-2">
        <div className="rounded-xl border border-edge/70 bg-panel/60 p-5">
          <h3 className="mb-3 text-sm font-medium uppercase tracking-wide text-mute">
            Disqualifiers
          </h3>
          <ul className="space-y-2 text-sm">
            {disqualifiers.map((dq) => (
              <li key={dq.id} className="flex gap-2">
                <span className="text-danger">•</span>
                <span>
                  <span className="font-mono text-xs">{dq.disqualifierType}</span>
                  {dq.lookbackMonths ? ` (${dq.lookbackMonths}mo)` : ""}
                  {dq.excludedStates?.length
                    ? ` — excl. ${dq.excludedStates.join(", ")}`
                    : ""}
                  {dq.detail ? (
                    <span className="block text-xs text-mute">{dq.detail}</span>
                  ) : null}
                </span>
              </li>
            ))}
            {disqualifiers.length === 0 && (
              <li className="text-mute">None recorded.</li>
            )}
          </ul>
        </div>

        <div className="rounded-xl border border-edge/70 bg-panel/60 p-5">
          <h3 className="mb-3 text-sm font-medium uppercase tracking-wide text-mute">
            Geographic eligibility
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {geo.map((g) => (
              <span
                key={g.id}
                className={`rounded px-2 py-0.5 text-xs ${
                  g.eligibility === "eligible"
                    ? "bg-accent/15 text-accent"
                    : g.eligibility === "ineligible"
                      ? "bg-danger/15 text-danger"
                      : "bg-edge/60 text-mute"
                }`}
              >
                {g.stateCode}
              </span>
            ))}
            {geo.length === 0 && <span className="text-sm text-mute">Not scoped.</span>}
          </div>
          {offer.termsUrl && (
            <a
              href={offer.termsUrl}
              className="mt-4 inline-block text-xs text-accent hover:underline"
            >
              Full terms →
            </a>
          )}
        </div>
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
      <div className={`mt-1 text-xl font-semibold ${accent ? "text-accent" : ""}`}>
        {value}
      </div>
    </div>
  );
}
