import "dotenv/config";
import { scoutApplicationPages } from "../lib/discovery/scout";

// Offline job: preview-scout every web application page with a real headless
// browser. Slow and network-dependent; run out of band, never in the app
// runtime. `npm run db:scout`.
async function main() {
  console.log("Scouting application pages (real headless browser)...");
  const r = await scoutApplicationPages();
  console.log(
    `Scout: ${r.captured} captured, ${r.blocked} blocked, ${r.error} error of ${r.scouted} web offers.`,
  );
  if (r.blocked > 0) {
    console.log(
      "  (blocked = the bank refused the headless browser — expected; cockpit falls back to the verified link.)",
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
