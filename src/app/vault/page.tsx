import { VaultForm } from "./VaultForm";

export const dynamic = "force-static";

export default function VaultPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Enter my details</h1>
        <p className="mt-1 text-sm text-mute">
          Fill this in once and download your <code className="text-accent">vault.json</code> — the
          config the desktop agent uses to pre-fill bank applications for you. It&apos;s built right
          here in your browser and saved to your machine.
        </p>
      </div>

      <div className="rounded-xl border border-warn/40 bg-warn/10 p-3 text-xs text-warn">
        Your identity fields (SSN, date of birth) never leave your browser — they are written only
        into the file you download, not sent to or stored by YieldFlow.
      </div>

      <div className="rounded-xl border border-edge/70 bg-panel/60 p-5">
        <VaultForm />
      </div>
    </div>
  );
}
