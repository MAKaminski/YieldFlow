/**
 * Per-bank entry-path verification. For EVERY active offer (all 16 banks), this:
 *   1. starts a campaign (offer → campaign + task chain + transfer plan),
 *   2. builds the desktop-agent job the way the API does,
 *   3. asserts the job is well-formed for the agent to drive:
 *      - a web offer has an applicationUrl + the agent's autofill/identity fields,
 *      - the step chain is present, and (for web) the identity keys are included.
 *
 * This proves the whole handoff works for each bank — the part testable here.
 * It does NOT drive the live bank DOM (blocked from a datacenter; needs the
 * user's real browser). Run:  npx tsx src/db/verify-banks.ts
 */
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { startCampaign } from "@/lib/orchestration";
import { buildAgentJob, AUTOFILL_FIELDS, IDENTITY_FIELDS } from "@/lib/agent";

async function demoUserId(): Promise<string> {
  const [u] = await db
    .select({ id: schema.userProfile.id })
    .from(schema.userProfile)
    .where(eq(schema.userProfile.email, "demo@yieldflow.app"))
    .limit(1);
  if (!u) throw new Error("demo user missing — run `npm run db:seed`");
  return u.id;
}

async function main() {
  const userId = await demoUserId();
  const offers = await db
    .select({
      id: schema.offer.id,
      title: schema.offer.title,
      channel: schema.offer.applicationChannel,
      url: schema.offer.applicationUrl,
      verified: schema.offer.applicationUrlVerified,
      brand: schema.institution.brandName,
    })
    .from(schema.offer)
    .innerJoin(schema.institution, eq(schema.offer.institutionId, schema.institution.id))
    .where(eq(schema.offer.status, "active"));

  let pass = 0;
  let fail = 0;
  const rows: string[] = [];
  for (const o of offers) {
    const problems: string[] = [];
    try {
      const campaignId = await startCampaign(userId, o.id);
      const job = await buildAgentJob(campaignId, "http://localhost:3000");
      if (!job) throw new Error("buildAgentJob returned null");

      // Every job, regardless of channel, must carry the field contract + steps.
      for (const k of AUTOFILL_FIELDS) if (!job.autofillFields.includes(k)) problems.push(`missing autofill:${k}`);
      for (const k of IDENTITY_FIELDS) {
        if (!job.autofillFields.includes(k)) problems.push(`identity ${k} not in autofill`);
        if (!job.identityFields.includes(k)) problems.push(`missing identity:${k}`);
      }
      if (!job.steps.length) problems.push("no steps");
      if (!job.progressUrl) problems.push("no progressUrl");

      // A web offer the agent drives must have a resolvable application URL.
      if (o.channel === "web" && !job.offer.applicationUrl) problems.push("web offer has no applicationUrl");
      if (job.offer.applicationChannel !== o.channel) problems.push("channel mismatch");
    } catch (e) {
      problems.push(`threw: ${String(e).slice(0, 100)}`);
    }

    const driveable = o.channel === "web";
    const mark = problems.length ? "✗" : "✓";
    if (problems.length) fail++;
    else pass++;
    rows.push(
      `  ${mark} ${o.brand!.padEnd(18)} ${o.channel!.padEnd(7)} ` +
        `${driveable ? (o.verified ? "verified" : "unverified") : "handoff "} ` +
        (problems.length ? `— ${problems.join("; ")}` : `— ${o.title!.slice(0, 40)}`),
    );
  }

  console.log(`Per-bank entry-path verification (${offers.length} active offers):\n`);
  console.log(rows.join("\n"));
  console.log(`\n${pass} ok, ${fail} problems`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
