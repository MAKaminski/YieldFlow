import Link from "next/link";
import { getCampaigns } from "@/lib/queries";
import { centsToUsd } from "@/lib/yield";

export const dynamic = "force-dynamic";

const STATUS_COLOR: Record<string, string> = {
  satisfied: "bg-accent/15 text-accent",
  in_progress: "bg-warn/15 text-warn",
  at_risk: "bg-danger/15 text-danger",
  not_started: "bg-edge/60 text-mute",
  failed: "bg-danger/15 text-danger",
};

export default async function CampaignsPage() {
  const campaigns = await getCampaigns();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Campaigns</h1>
        <p className="mt-1 max-w-2xl text-sm text-mute">
          One campaign = one user pursuing one offer. Each tracks per-requirement
          progress against its deadline, plus the clawback-safe close date.
        </p>
      </div>

      <div className="space-y-4">
        {campaigns.map(({ campaign, offer, institution, progress }) => (
          <div
            key={campaign.id}
            className="rounded-xl border border-edge/70 bg-panel/60 p-5"
          >
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <Link
                  href={`/offers/${offer.id}`}
                  className="text-lg font-medium hover:text-accent"
                >
                  {offer.title}
                </Link>
                <p className="text-sm text-mute">
                  {institution.brandName} · deadline{" "}
                  {campaign.requirementsDeadline
                    ? fmtDate(campaign.requirementsDeadline)
                    : "—"}
                  {campaign.earliestSafeCloseDate
                    ? ` · safe to close ${fmtDate(campaign.earliestSafeCloseDate)}`
                    : ""}
                </p>
              </div>
              <div className="text-right">
                <span className="rounded bg-edge px-2 py-0.5 text-xs font-semibold">
                  {campaign.status}
                </span>
                <div className="mt-1 text-sm text-mute">
                  {campaign.expectedBonusCents
                    ? `expect ${centsToUsd(campaign.expectedBonusCents)}`
                    : ""}
                </div>
              </div>
            </div>

            <ul className="mt-4 space-y-2">
              {progress.map(({ progress: p, requirement }) => {
                const target = p.targetAmountCents ?? 0;
                const accrued = p.accruedAmountCents ?? 0;
                const pct = target > 0 ? Math.min(100, (accrued / target) * 100) : 0;
                return (
                  <li key={p.id} className="text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs">
                        {requirement.requirementType}
                      </span>
                      <span
                        className={`rounded px-2 py-0.5 text-[10px] uppercase tracking-wide ${
                          STATUS_COLOR[p.status] ?? "bg-edge/60 text-mute"
                        }`}
                      >
                        {p.status.replace(/_/g, " ")}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center gap-3">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-edge/60">
                        <div
                          className="h-full rounded-full bg-accent"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="w-28 text-right text-xs text-mute">
                        {target > 0
                          ? `${centsToUsd(accrued)} / ${centsToUsd(target)}`
                          : `${p.accruedCount}/${p.targetCount ?? 0}`}
                      </span>
                    </div>
                  </li>
                );
              })}
              {progress.length === 0 && (
                <li className="text-sm text-mute">No requirement progress yet.</li>
              )}
            </ul>
          </div>
        ))}
        {campaigns.length === 0 && (
          <p className="rounded-xl border border-edge/70 bg-panel/60 p-6 text-sm text-mute">
            No campaigns yet.
          </p>
        )}
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
