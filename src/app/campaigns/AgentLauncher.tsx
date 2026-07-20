"use client";

import { useEffect, useState } from "react";

interface ProgressEvent {
  taskType?: string;
  status?: string;
  note?: string;
  at?: string | null;
}

// Launches the local desktop agent via the yieldflow:// protocol and shows live
// progress it reports back. The agent runs on the user's own machine, pre-fills
// the application, and pauses for the user to complete identity verification.
export function AgentLauncher({ campaignId }: { campaignId: string }) {
  const [events, setEvents] = useState<ProgressEvent[]>([]);
  const [launched, setLaunched] = useState(false);

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
