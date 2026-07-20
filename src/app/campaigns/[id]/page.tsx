import Link from "next/link";
import { notFound } from "next/navigation";
import { getCampaignDetail } from "@/lib/queries";
import { centsToUsd } from "@/lib/yield";
import { CopyChip } from "../CopyChip";
import { AgentLauncher } from "../AgentLauncher";
import {
  advanceTaskAction,
  approveTransferPlanAction,
  abandonCampaignAction,
} from "../actions";

export const dynamic = "force-dynamic";

type TaskInstructions = {
  title?: string;
  detail?: string;
  ctaLabel?: string;
  url?: string;
  channel?: "web" | "app" | "branch" | "phone";
  copyValues?: { label: string; value: string }[];
  warning?: string;
};

const TASK_LABEL: Record<string, string> = {
  open_account: "Open the account",
  enroll_estatements: "Enroll in e-statements",
  initiate_transfer: "Fund the account",
  redirect_direct_deposit: "Set up qualifying direct deposit",
  schedule_debit_txns: "Schedule debit transactions",
  confirm_bonus_posted: "Confirm bonus posted",
  close_account: "Recall funds & close (after clawback window)",
  verify_micro_deposits: "Verify micro-deposits",
  file_complaint: "Escalate / file complaint",
};

const STATUS_STYLE: Record<string, string> = {
  done: "bg-accent/15 text-accent",
  pending: "bg-warn/15 text-warn",
  awaiting_user: "bg-warn/15 text-warn",
  blocked: "bg-edge/60 text-mute",
  in_flight: "bg-warn/15 text-warn",
  failed: "bg-danger/15 text-danger",
};

export default async function CampaignCockpit({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const c = await getCampaignDetail(id);
  if (!c) notFound();

  const { campaign, offer, institution, tasks, progress, plan, legs } = c;
  const planApproved = !!plan?.approvedByUserAt;

  return (
    <div className="space-y-8">
      <div>
        <Link href="/campaigns" className="text-sm text-mute hover:text-slate-100">
          ← Campaigns
        </Link>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{offer.title}</h1>
            <p className="mt-1 text-sm text-mute">
              {institution.brandName} · status{" "}
              <span className="text-slate-200">{campaign.status}</span>
            </p>
          </div>
          <div className="flex gap-6 text-right text-sm">
            <div>
              <div className="text-[10px] uppercase tracking-wide text-mute">Deadline</div>
              <div>{fmt(campaign.requirementsDeadline)}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-mute">Safe to close</div>
              <div>{fmt(campaign.earliestSafeCloseDate)}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-mute">Expected</div>
              <div className="text-accent">
                {campaign.expectedBonusCents ? centsToUsd(campaign.expectedBonusCents) : "—"}
              </div>
            </div>
          </div>
        </div>
      </div>

      <p className="rounded-lg border border-edge/70 bg-panel/40 p-3 text-xs text-mute">
        Advisory + assisted. YieldFlow drives the checklist and pre-fills bank links, but
        identity verification and any real money movement stay with you and behind the approval
        gate below — we never take custody of funds.
      </p>

      <AgentLauncher campaignId={campaign.id} />

      {/* Task queue */}
      <section className="space-y-3">
        <h2 className="text-lg font-medium">Action plan</h2>
        <ol className="space-y-2">
          {tasks.map((t, i) => {
            const ins = (t.resultJson as { instructions?: TaskInstructions } | null)
              ?.instructions;
            const link = ins?.url ?? t.userActionUrl ?? undefined;
            return (
              <li
                  key={t.id}
                  className="rounded-lg border border-edge/60 bg-panel/60 p-4"
                >
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="text-xs text-mute">{i + 1}</span>
                    <span className="flex-1 font-medium">
                      {ins?.title ?? TASK_LABEL[t.taskType] ?? t.taskType}
                      <span className="ml-2 text-[10px] uppercase tracking-wide text-mute">
                        {t.automationMode.replace(/_/g, " ")}
                      </span>
                    </span>
                    <span
                      className={`rounded px-2 py-0.5 text-[10px] uppercase tracking-wide ${
                        STATUS_STYLE[t.status] ?? "bg-edge/60 text-mute"
                      }`}
                    >
                      {t.status.replace(/_/g, " ")}
                    </span>
                  </div>

                  {ins?.detail && (
                    <p className="mt-2 text-sm text-mute">{ins.detail}</p>
                  )}
                  {ins?.warning && (
                    <p className="mt-2 rounded border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
                      ⚠ {ins.warning}
                    </p>
                  )}

                  {t.taskType === "open_account" &&
                    offer.scoutStatus === "captured" && (
                      <div className="mt-3 rounded-lg border border-accent/30 bg-ink/40 p-3">
                        <div className="mb-2 flex items-center gap-2 text-xs">
                          <span className="font-medium text-accent">
                            Previewed by YieldFlow
                          </span>
                          <span className="text-mute">
                            a browser opened this page — here's what you'll see. Preview
                            only; you complete identity verification.
                          </span>
                        </div>
                        {offer.scoutScreenshot && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={offer.scoutScreenshot}
                            alt={`${institution.brandName} application page preview`}
                            className="mb-2 max-h-64 w-full rounded border border-edge/60 object-cover object-top"
                          />
                        )}
                        {offer.scoutFields && offer.scoutFields.length > 0 && (
                          <div className="flex flex-wrap gap-1.5">
                            <span className="text-[10px] uppercase tracking-wide text-mute">
                              you'll be asked for:
                            </span>
                            {offer.scoutFields.map((f) => (
                              <span
                                key={f}
                                className="rounded bg-edge/60 px-1.5 py-0.5 text-[11px] text-slate-200"
                              >
                                {f}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                  {(ins?.copyValues?.length ||
                    (link && t.status !== "done") ||
                    t.status === "pending" ||
                    t.status === "awaiting_user") && (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {ins?.copyValues?.map((cv) => (
                        <CopyChip key={cv.label} label={cv.label} value={cv.value} />
                      ))}
                      {link && t.status !== "done" && (
                        <a
                          href={
                            t.taskType === "open_account" ? `/go/${offer.id}` : link
                          }
                          target="_blank"
                          rel="noreferrer"
                          className="rounded border border-accent/50 px-3 py-1 text-xs text-accent hover:bg-accent/10"
                        >
                          {ins?.ctaLabel ?? "Open bank ↗"}
                        </a>
                      )}
                      {t.taskType === "open_account" &&
                        offer.applicationUrlVerified &&
                        link && (
                          <span className="text-[10px] uppercase tracking-wide text-accent">
                            link verified ✓
                          </span>
                        )}
                      {(t.status === "pending" || t.status === "awaiting_user") && (
                        <form action={advanceTaskAction.bind(null, t.id, campaign.id)}>
                          <button
                            type="submit"
                            className="rounded bg-accent/90 px-3 py-1 text-xs font-medium text-ink hover:bg-accent"
                          >
                            Mark done
                          </button>
                        </form>
                      )}
                    </div>
                  )}
                </li>
            );
          })}
        </ol>
      </section>

      {/* Transfer plan (approval-gated) */}
      {plan && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-medium">Funding &amp; recall plan</h2>
            <span
              className={`rounded px-2 py-0.5 text-[10px] uppercase tracking-wide ${
                planApproved ? "bg-accent/15 text-accent" : "bg-warn/15 text-warn"
              }`}
            >
              {plan.status}
            </span>
          </div>
          <div className="rounded-lg border border-edge/60 bg-panel/60 p-4">
            <ul className="space-y-2 text-sm">
              {legs.map((leg) => (
                <li key={leg.id} className="flex items-center justify-between gap-3">
                  <span>
                    <span className="font-medium">
                      {leg.purpose === "wind_down" ? "Recall funds" : "Fund account"}
                    </span>
                    <span className="ml-2 text-xs text-mute">
                      {centsToUsd(leg.amountCents)} · {leg.rail.replace(/_/g, " ")} ·{" "}
                      {leg.purpose === "wind_down"
                        ? `on ${fmt(leg.earliestInitiateDate)}`
                        : `by ${fmt(leg.expectedSettleDate)}`}
                    </span>
                  </span>
                  <span className="text-[10px] uppercase tracking-wide text-mute">
                    {leg.status}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-mute">
              Legs need a connected funding account (
              <span className="text-slate-300">Feature 4 — backlogged</span>) and an ACH provider
              before they can execute. Approval here authorizes the plan; nothing moves yet.
            </p>
            {!planApproved && (
              <form
                action={approveTransferPlanAction.bind(null, plan.id, campaign.id)}
                className="mt-3"
              >
                <button
                  type="submit"
                  className="rounded bg-accent/90 px-4 py-1.5 text-sm font-medium text-ink hover:bg-accent"
                >
                  Approve plan ✓
                </button>
              </form>
            )}
          </div>
        </section>
      )}

      {/* Requirement progress */}
      <section className="space-y-3">
        <h2 className="text-lg font-medium">Requirements</h2>
        <ul className="space-y-2">
          {progress.map(({ progress: p, requirement }) => {
            const target = p.targetAmountCents ?? 0;
            const accrued = p.accruedAmountCents ?? 0;
            const pct = target > 0 ? Math.min(100, (accrued / target) * 100) : 0;
            return (
              <li key={p.id} className="text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs">{requirement.requirementType}</span>
                  <span className="text-xs text-mute">{p.status.replace(/_/g, " ")}</span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-edge/60">
                  <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
                </div>
              </li>
            );
          })}
          {progress.length === 0 && <li className="text-sm text-mute">No requirements.</li>}
        </ul>
      </section>

      <form action={abandonCampaignAction.bind(null, campaign.id)}>
        <button type="submit" className="text-xs text-mute hover:text-danger">
          Abandon campaign
        </button>
      </form>
    </div>
  );
}

function fmt(d: Date | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
