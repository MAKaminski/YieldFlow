export const dynamic = "force-static";

export default function DownloadPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">YieldFlow Agent (desktop)</h1>
        <p className="mt-1 text-sm text-mute">
          A small app that runs on your own machine. It opens a bank application in a real
          browser, pre-fills the fields it can, and pauses for you to complete identity
          verification and submit. Your SSN and identity data stay on your device — they are
          never sent to YieldFlow.
        </p>
      </div>

      <div className="rounded-xl border border-edge/70 bg-panel/60 p-5 text-sm">
        <p className="text-mute">
          Installers are produced from the <code className="text-accent">agent/</code> project in
          the repo (Tauri). Signed builds aren&apos;t hosted here yet — build locally:
        </p>
        <pre className="mt-3 overflow-x-auto rounded-lg border border-edge/60 bg-ink/50 p-3 text-xs">
{`cd agent
npm install
npm run tauri build      # -> Windows .exe / macOS .dmg / Linux AppImage`}
        </pre>
        <p className="mt-3 text-xs text-mute">
          After install, the app registers the <code>yieldflow://</code> link handler, so the
          &quot;Launch agent&quot; button on a campaign opens it directly.
        </p>
      </div>

      <div className="rounded-xl border border-edge/70 bg-panel/40 p-5 text-xs text-mute">
        <div className="mb-1 font-medium text-slate-200">What it does / doesn&apos;t do</div>
        <ul className="space-y-1">
          <li>• Runs on your machine, in a real browser session you control.</li>
          <li>• Pre-fills non-identity fields (name, address, email, promo code).</li>
          <li>• Pauses for you to do identity verification, CAPTCHA, and submit.</li>
          <li>• Never disguises itself or evades bank security; degrades to copy-paste if a bank blocks automation.</li>
          <li>• Never moves money or takes custody of funds.</li>
        </ul>
      </div>
    </div>
  );
}
