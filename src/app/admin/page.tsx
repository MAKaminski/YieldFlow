import { getAllFlags } from "@/lib/flags";
import { FlagToggle } from "./FlagToggle";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const flags = await getAllFlags();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Admin</h1>
        <p className="mt-1 text-sm text-mute">
          Operational controls. Feature flags gate unreleased features — flip one on to expose it
          across the app.
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-widest text-mute">Feature flags</h2>
        <div className="divide-y divide-edge/60 overflow-hidden rounded-xl border border-edge/70 bg-panel/60">
          {flags.map((f) => (
            <div key={f.key} className="flex items-start justify-between gap-6 px-5 py-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-slate-100">{f.label}</span>
                  <code className="rounded bg-edge/50 px-1.5 py-0.5 text-[11px] text-mute">{f.key}</code>
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] uppercase tracking-widest ${
                      f.enabled ? "bg-accent/20 text-accent" : "bg-edge/60 text-mute"
                    }`}
                  >
                    {f.enabled ? "on" : "off"}
                  </span>
                </div>
                <p className="mt-1 text-sm text-mute">{f.description}</p>
              </div>
              <FlagToggle flagKey={f.key} enabled={f.enabled} />
            </div>
          ))}
        </div>
        <p className="text-xs text-mute">
          Toggles apply immediately. A flag that is <b>off</b> hides its feature everywhere (nav +
          pages).
        </p>
      </section>
    </div>
  );
}
