import { eq, asc } from "drizzle-orm";
import { db, schema } from "@/db";

// Contract between the cloud app and the local desktop agent (the .exe).
//
// The cloud hands the agent a JOB describing WHICH offer to pursue and WHAT to
// fill — but never the user's sensitive identity data. Non-sensitive autofill
// values + all identity values live in the agent's LOCAL vault on the user's
// machine and are merged in there. The user completes identity verification,
// CAPTCHA, and the final submit themselves. The agent pre-fills and navigates —
// it does not impersonate or evade detection.

export const JOB_SCHEMA_VERSION = 1;

/** Non-sensitive fields the agent may auto-fill from its local vault. */
export const AUTOFILL_FIELDS = [
  "firstName",
  "middleName",
  "lastName",
  "email",
  "phone",
  "addressLine1",
  "addressLine2",
  "city",
  "state",
  "zip",
] as const;

/**
 * Identity fields. The agent fills these too IF the user put them in their local
 * vault (opt-in) — they're never sent by the cloud (only the KEYS are). If absent
 * from the vault, the user types them; either way the agent never submits.
 */
export const IDENTITY_FIELDS = ["dateOfBirth", "ssn"] as const;

export interface AgentJob {
  schemaVersion: number;
  campaignId: string;
  offer: {
    title: string;
    brand: string;
    applicationUrl: string | null;
    applicationChannel: string;
    applicationUrlVerified: boolean;
    offerCode: string | null;
    signupNotes: string | null;
  };
  steps: { taskType: string; title: string; detail: string; url?: string }[];
  /** Field keys the agent may fill from its local vault. */
  autofillFields: readonly string[];
  /** Field keys the user must enter/confirm themselves. */
  identityFields: readonly string[];
  /** Where the agent reports progress back to. */
  progressUrl: string;
}

/** Build the job payload for a campaign (no sensitive data included). */
export async function buildAgentJob(
  campaignId: string,
  origin: string,
): Promise<AgentJob | null> {
  const [head] = await db
    .select({
      campaign: schema.campaign,
      offer: schema.offer,
      institution: schema.institution,
    })
    .from(schema.campaign)
    .innerJoin(schema.offer, eq(schema.campaign.offerId, schema.offer.id))
    .innerJoin(schema.institution, eq(schema.offer.institutionId, schema.institution.id))
    .where(eq(schema.campaign.id, campaignId))
    .limit(1);
  if (!head) return null;

  const tasks = await db
    .select()
    .from(schema.campaignTask)
    .where(eq(schema.campaignTask.campaignId, campaignId))
    .orderBy(asc(schema.campaignTask.createdAt));

  const steps = tasks.map((t) => {
    const ins = (t.resultJson as { instructions?: { title?: string; detail?: string; url?: string } } | null)
      ?.instructions;
    return {
      taskType: t.taskType,
      title: ins?.title ?? t.taskType,
      detail: ins?.detail ?? "",
      url: ins?.url ?? t.userActionUrl ?? undefined,
    };
  });

  return {
    schemaVersion: JOB_SCHEMA_VERSION,
    campaignId,
    offer: {
      title: head.offer.title,
      brand: head.institution.brandName,
      applicationUrl: head.offer.applicationUrl,
      applicationChannel: head.offer.applicationChannel,
      applicationUrlVerified: !!head.offer.applicationUrlVerified,
      offerCode: head.offer.offerCode,
      signupNotes: head.offer.signupNotes,
    },
    steps,
    // The agent may fill any of these from the LOCAL vault (values never leave the
    // machine). Identity keys included so DOB/SSN auto-fill when the user opted in.
    autofillFields: [...AUTOFILL_FIELDS, ...IDENTITY_FIELDS],
    identityFields: IDENTITY_FIELDS,
    progressUrl: `${origin}/api/agent/progress`,
  };
}
