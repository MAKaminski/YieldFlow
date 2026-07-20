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
        <p className="font-medium text-slate-200">Run it now — no install (Node 18+ and Chrome)</p>
        <p className="mt-1 text-mute">The agent is just a Node script; you don&apos;t need Tauri or Rust to use it.</p>
        <pre className="mt-3 overflow-x-auto rounded-lg border border-edge/60 bg-ink/50 p-3 text-xs">
{`# main is empty until the PR merges — clone the feature branch
git clone -b claude/deposit-bonus-harvesting-agent-3fho6a https://github.com/MAKaminski/YieldFlow
cd YieldFlow/agent
npm install
mkdir -p ~/.yieldflow && cp vault.example.json ~/.yieldflow/vault.json   # edit it

# then, from a campaign page, copy its "Run it now" command (real id + domain), e.g.
node run.mjs https://<your-domain>/campaigns/THE_CAMPAIGN_ID --dry-run   # test
node run.mjs https://<your-domain>/campaigns/THE_CAMPAIGN_ID             # for real`}
        </pre>
        <p className="mt-3 text-xs text-mute">
          Each campaign page has a <b>&quot;Run it now&quot;</b> block with the command already filled
          in with the campaign id and this domain.
        </p>
      </div>

      <div className="rounded-xl border border-edge/70 bg-panel/60 p-5 text-sm">
        <p className="font-medium text-slate-200">Optional (later): the one-click desktop app</p>
        <p className="mt-1 text-mute">
          Packaging into a signed installer that registers the <code>yieldflow://</code> link (so
          the <b>Launch agent</b> button opens it directly) uses the Tauri project in{" "}
          <code className="text-accent">agent/desktop/</code>. It needs Rust + the Tauri CLI + a
          code-signing cert — see <code>agent/README.md</code>.
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
