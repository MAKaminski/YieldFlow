# Agent coverage — what's proven, per bank and per pattern

The agent is **one generic engine**, not per-bank code. So "does it work for bank
X" splits into two questions, tested at two levels:

1. **Entry path** (offer → campaign → job → agent plan) — *verifiable here, for
   every bank.* `npm run db:verify-banks` builds the real job for all 18 active
   offers and asserts the handoff is well-formed (application URL + channel, the
   autofill/identity field contract, step chain, progress URL).
2. **Driving the live form** — depends on whether the bank's DOM matches a
   **pattern class** the engine handles. The classes are proven by the headless
   harness (`cd agent && npm test`, 60 assertions) against faithful fixtures.
   The *live* DOM per bank still needs a real run in your Chrome (datacenter IPs
   are bot-blocked, and KYC is yours).

## Pattern classes the engine handles (harness-proven)

| Class | Fixture | What it proves |
|---|---|---|
| SPA gate → CTA among decoys → radio → form → identity | `bmo.html` | ZIP modal submit, pick "OPEN NOW" over nav/footer decoys, required radio, prefill, identity stop |
| Multi-URL flow (real page navigations) | `multiurl*.html` | prefill re-runs per page; no false "stuck" on URL change |
| Fields labelled only by `<label for>` / wrapping `<label>` / `aria-labelledby` | `smartform.html` | resolves label text (the reason a real run filled only 6/21) |
| Split DOB (Month/Day/Year) + masked & 3-part SSN | `splitdob.html`, `ssnsplit.html` | one vault value distributed across sub-fields; masked SSN fills |
| Form inside an `<iframe>` | `iframe.html` | frame-aware prefill + identity stop |
| Multi-step wizard **inside** an iframe | `iframe-wizard.html` | frame-aware CTA click advances the in-frame wizard |
| Cookie/consent banner | `cookie.html` | dismissed, not mistaken for the app gate |
| Stale re-rendering button | `stale.html` | re-locate-at-click-time (no "element not attached") |
| New-tab CTA | `newtab.html` | follows the opened tab |
| Non-advancing step | `stuck.html` | hands over after one try instead of looping |
| `--auto` mode | (bmo) | no prompts; declines add-ons; still stops at identity |

## Per-bank status

All 16 banks pass the **entry-path** check (`db:verify-banks` → 18/18). Live-DOM
is confirmed only where a real run has been done.

| Bank | Channel | Entry path | Live form |
|---|---|---|---|
| Chase, SoFi, Capital One, U.S. Bank, Wells Fargo, Fifth Third, Truist, Citibank, TD Bank, Associated | web | ✓ verified link | ⧗ needs a real run |
| PNC, BMO, KeyBank, Huntington, M&T | web | ✓ (link unverified from datacenter — may be fine for a real user) | ⧗ needs a real run — **BMO** partially observed (reached the SmartForm, filled 6/21 before the `<label>` fix) |
| Regions (checking + MMA) | web | ✓ verified link | ⧗ needs a real run |
| Varo | app | ✓ handoff (app-only — no web form; agent points you to the app store) | n/a by design |

**⧗ = the honest gap.** The engine covers the pattern classes above; each bank's
live form needs one real run to confirm which class it falls into (and to surface
any label the engine doesn't yet recognise). The fastest way to close every ⧗ is
a run per bank: `node run.mjs <campaign-url>` → send the `~/.yieldflow/runs/<ts>/`
folder. The `run.log` names exactly which fields filled and which didn't, so any
miss becomes a one-line hint to add — no guessing.
