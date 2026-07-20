"use client";

import { useEffect, useState } from "react";

interface ProgressEvent {
  taskType?: string;
  status?: string;
  note?: string;
  at?: string | null;
}

// Launches the local desktop agent via the yieldflow:// protocol (once the .exe
// is installed) and shows live progress it reports back. Also hands the user the
// exact CLI command so they can run the agent TODAY with no install (Node + the
// agent/ folder). The agent runs on the user's own machine, pre-fills the
// application, and pauses for the user to complete identity verification.
export function AgentLauncher({
  campaignId,
  origin,
}: {
  campaignId: string;
  origin: string;
}) {
  const [events, setEvents] = useState<ProgressEvent[]>([]);
  const [launched, setLaunched] = useState(false);
  const [copied, setCopied] = useState(false);

  const setup = `git clone -b claude/deposit-bonus-harvesting-agent-3fho6a https://github.com/MAKaminski/YieldFlow && cd YieldFlow/agent && npm install`;
  // Pass the full campaign URL so the agent derives the base automatically.
  const cmd = `node run.mjs ${origin || "https://<your-domain>"}/campaigns/${campaignId}`;

  useEffect(() => {
    if (!launched) return;
    let alive = true;
    const poll = async () => {
      try {
        const res = await fetch(`/api/agent/progress?campaignId=${campaignId}`, {
          cache: "no-store",
        });
        const data = await res.json();
        if (alive) setEvents(data.events ?? []);
      } catch {
        /* ignore */
      }
    };
    poll();
    const id = setInterval(poll, 4000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [launched, campaignId]);

  return (
    <div className="rounded-lg border border-accent/30 bg-panel/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium">Agentic sign-up (desktop)</div>
          <p className="text-xs text-mute">
            Launch the local YieldFlow Agent to open the application on your machine and
            pre-fill it. You complete identity verification and submit — we never see your SSN.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={`yieldflow://campaign/${campaignId}`}
            onClick={() => setLaunched(true)}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-ink hover:bg-accent/90"
          >
            Launch agent →
          </a>
          <a
            href="/download"
            className="text-xs text-mute underline hover:text-slate-200"
          >
            Not installed?
          </a>
        </div>
      </div>

      {/* Works today, no install: run the agent as a Node CLI. */}
      <details className="mt-3 border-t border-edge/60 pt-3">
        <summary className="cursor-pointer text-xs text-mute hover:text-slate-200">
          Run it now without installing the app (Node + Chrome)
        </summary>
        <div className="mt-2 space-y-2">
          <p className="text-[11px] text-mute">One-time setup:</p>
          <pre className="overflow-x-auto rounded border border-edge/60 bg-ink/50 p-2 text-[11px]">
            {setup}
          </pre>
          <p className="text-[11px] text-mute">Then, for this campaign:</p>
          <div className="flex items-start gap-2">
            <pre className="flex-1 overflow-x-auto rounded border border-edge/60 bg-ink/50 p-2 text-[11px]">
              {cmd}
            </pre>
            <button
              type="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(cmd);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                } catch {
                  /* clipboard blocked */
                }
              }}
              className="rounded border border-edge/70 px-2 py-1 text-[11px] hover:border-accent/60"
            >
              {copied ? "✓" : "Copy"}
            </button>
          </div>
          <p className="text-[11px] text-mute">
            Add <code>--dry-run</code> first to test the connection without opening a browser.
          </p>
        </div>
      </details>

      {launched && (
        <div className="mt-3 border-t border-edge/60 pt-3">
          <div className="text-[10px] uppercase tracking-wide text-mute">Agent activity</div>
          {events.length === 0 ? (
            <p className="mt-1 text-xs text-mute">
              Waiting for the agent… if nothing happens, the app may not be installed.
            </p>
          ) : (
            <ul className="mt-1 space-y-1">
              {events.map((e, i) => (
                <li key={i} className="flex items-center gap-2 text-xs">
                  <span className="text-accent">•</span>
                  <span className="font-mono text-mute">{e.taskType ?? "step"}</span>
                  <span>{(e.status ?? "").replace(/_/g, " ")}</span>
                  {e.note && <span className="text-mute">— {e.note}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
