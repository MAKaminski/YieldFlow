import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { DiscoveredOffer, IngestSourceMeta, IngestResult } from "./types";

// Normalizes DiscoveredOffer[] into the Domain B/C tables. Unlike seed.ts this
// is ADDITIVE and idempotent — it upserts institutions/products and dedupes
// offers by (institutionId, title), so existing demo data (Regions) survives
// and re-runs don't duplicate rows.

function hash(input: string): string {
  return "sha256:" + createHash("sha256").update(input).digest("hex").slice(0, 32);
}

async function upsertInstitution(o: DiscoveredOffer): Promise<string> {
  const existing = await db
    .select({ id: schema.institution.id })
    .from(schema.institution)
    .where(eq(schema.institution.brandName, o.brandName))
    .limit(1);
  if (existing[0]) return existing[0].id;

  const [row] = await db
    .insert(schema.institution)
    .values({
      legalName: o.legalName,
      brandName: o.brandName,
      charterType: o.charterType,
      hqState: o.hqState,
      chexsystemsSensitivity: o.chexsystemsSensitivity ?? "unknown",
      earlyClosureClawbackDays: o.earlyClosureClawbackDays,
      supportsPlaid: true,
      status: "active",
    })
    .returning({ id: schema.institution.id });

  // Record footprint states (branch coverage) when provided.
  const footprint = o.footprintStates ?? o.geoEligibleStates ?? [];
  if (footprint.length) {
    await db.insert(schema.institutionFootprint).values(
      footprint.map((stateCode) => ({
        institutionId: row.id,
        stateCode,
        coverageType: "branch" as const,
      })),
    );
  }
  return row.id;
}

async function upsertProduct(o: DiscoveredOffer, institutionId: string): Promise<string> {
  const existing = await db
    .select({ id: schema.product.id })
    .from(schema.product)
    .where(
      and(
        eq(schema.product.institutionId, institutionId),
        eq(schema.product.productName, o.productName),
      ),
    )
    .limit(1);
  if (existing[0]) return existing[0].id;

  const [row] = await db
    .insert(schema.product)
    .values({
      institutionId,
      productName: o.productName,
      productType: o.productType,
      monthlyFeeCents: o.monthlyFeeCents ?? 0,
      minOpeningDepositCents: o.minOpeningDepositCents ?? 0,
      standardApyBps: o.standardApyBps ?? 0,
      isInterestBearing: (o.standardApyBps ?? 0) > 0 || o.productType !== "checking",
      accountOpeningUrl: o.accountOpeningUrl ?? o.termsUrl,
    })
    .returning({ id: schema.product.id });
  return row.id;
}

async function insertOfferTree(
  o: DiscoveredOffer,
  institutionId: string,
  productId: string,
  runId: string,
): Promise<void> {
  const [rawDoc] = await db
    .insert(schema.offerRawDocument)
    .values({
      offerIngestRunId: runId,
      sourceUrl: o.sourceUrl,
      contentHash: hash(o.brandName + "|" + o.title),
      extractedText: o.title,
      capturedAt: new Date(),
    })
    .returning({ id: schema.offerRawDocument.id });

  const [offerRow] = await db
    .insert(schema.offer)
    .values({
      institutionId,
      productId,
      offerCode: o.offerCode,
      title: o.title,
      bonusType: o.bonusType,
      bonusAmountCents: o.bonusAmountCents,
      bonusApyBps: o.bonusApyBps,
      currency: "USD",
      offerEndDate: o.offerEndDate ? new Date(o.offerEndDate + "T00:00:00Z") : undefined,
      requirementWindowDays: o.requirementWindowDays,
      payoutWindowDays: o.payoutWindowDays,
      isTargeted: o.isTargeted ?? false,
      targetingChannel: o.isTargeted ? "mail" : "public",
      newMoneyRequired: o.newMoneyRequired ?? false,
      newCustomerRequired: o.newCustomerRequired ?? false,
      customerLookbackMonths: o.customerLookbackMonths,
      termsUrl: o.termsUrl,
      affiliateUrl: o.affiliateUrl,
      affiliateNetwork: o.affiliateNetwork,
      applicationUrl: o.applicationUrl ?? o.accountOpeningUrl ?? o.termsUrl,
      applicationChannel: o.applicationChannel ?? "web",
      signupNotes: o.signupNotes,
      rawDocumentId: rawDoc.id,
      extractionConfidence: o.extractionConfidence,
      verificationStatus: o.verificationStatus ?? "unverified",
      status: "active",
    })
    .returning({ id: schema.offer.id });

  const offerId = offerRow.id;

  const [group] = await db
    .insert(schema.requirementGroup)
    .values({
      offerId,
      logicOperator: "ALL",
      sequence: 0,
      description: "All conditions required to earn the bonus",
    })
    .returning({ id: schema.requirementGroup.id });

  if (o.requirements.length) {
    await db.insert(schema.requirement).values(
      o.requirements.map((r) => ({
        requirementGroupId: group.id,
        requirementType: r.requirementType,
        targetAmountCents: r.targetAmountCents,
        targetCount: r.targetCount,
        windowDays: r.windowDays,
        windowStartAnchor: r.windowStartAnchor ?? ("account_open" as const),
        depositSourceConstraint: r.depositSourceConstraint,
        isBonusGating: r.isBonusGating ?? true,
        verificationDifficulty: r.verificationDifficulty ?? ("deterministic" as const),
        confidenceNotes: r.confidenceNotes,
      })),
    );
  }

  // Disqualifiers (explicit + derived from excluded states).
  const disqualifiers = [...(o.disqualifiers ?? [])];
  if (o.geoExcludedStates?.length) {
    disqualifiers.push({
      disqualifierType: "state_excluded",
      excludedStates: o.geoExcludedStates,
      detail: "Not available in these states.",
    });
  }
  if (disqualifiers.length) {
    await db.insert(schema.disqualifier).values(
      disqualifiers.map((dq) => ({
        offerId,
        disqualifierType: dq.disqualifierType,
        lookbackMonths: dq.lookbackMonths,
        excludedStates: dq.excludedStates,
        includedStatesOnly: dq.includedStatesOnly,
        detail: dq.detail,
      })),
    );
  }

  // Geo eligibility rows.
  const geoRows: {
    offerId: string;
    stateCode: string;
    eligibility: "eligible" | "ineligible" | "unknown";
  }[] = [];
  for (const s of o.geoEligibleStates ?? o.footprintStates ?? []) {
    geoRows.push({ offerId, stateCode: s, eligibility: "eligible" });
  }
  for (const s of o.geoExcludedStates ?? []) {
    geoRows.push({ offerId, stateCode: s, eligibility: "ineligible" });
  }
  if (geoRows.length) await db.insert(schema.geoEligibility).values(geoRows);
}

export async function ingestOffers(
  dataset: DiscoveredOffer[],
  sourceMeta: IngestSourceMeta,
): Promise<IngestResult> {
  // One source + one ingest run per invocation.
  let sourceId: string;
  const existingSource = await db
    .select({ id: schema.offerSource.id })
    .from(schema.offerSource)
    .where(eq(schema.offerSource.sourceName, sourceMeta.sourceName))
    .limit(1);
  if (existingSource[0]) {
    sourceId = existingSource[0].id;
  } else {
    const [s] = await db
      .insert(schema.offerSource)
      .values({
        sourceType: sourceMeta.sourceType,
        sourceName: sourceMeta.sourceName,
        baseUrl: sourceMeta.baseUrl,
        trustScore: sourceMeta.trustScore ?? 0.8,
        requiresTargetedMailer: false,
      })
      .returning({ id: schema.offerSource.id });
    sourceId = s.id;
  }

  const [run] = await db
    .insert(schema.offerIngestRun)
    .values({
      offerSourceId: sourceId,
      startedAt: new Date(),
      status: "success",
      pagesFetched: dataset.length,
    })
    .returning({ id: schema.offerIngestRun.id });

  let offersNew = 0;
  let offersUpdated = 0;
  let offersChanged = 0;
  let skipped = 0;

  for (const o of dataset) {
    const institutionId = await upsertInstitution(o);
    const productId = await upsertProduct(o, institutionId);

    // Dedupe offer by (institutionId, title).
    const existingOffer = await db
      .select({
        id: schema.offer.id,
        bonusAmountCents: schema.offer.bonusAmountCents,
        offerEndDate: schema.offer.offerEndDate,
        applicationUrl: schema.offer.applicationUrl,
      })
      .from(schema.offer)
      .where(
        and(
          eq(schema.offer.institutionId, institutionId),
          eq(schema.offer.title, o.title),
        ),
      )
      .limit(1);

    if (existingOffer[0]) {
      const prev = existingOffer[0];
      const newAppUrl = o.applicationUrl ?? o.accountOpeningUrl ?? o.termsUrl ?? null;
      const newEnd = o.offerEndDate ? new Date(o.offerEndDate + "T00:00:00Z") : null;

      // Diff the fields that matter and record each change for auditability.
      const changes: { field: string; oldValue: unknown; newValue: unknown }[] = [];
      if ((prev.bonusAmountCents ?? null) !== (o.bonusAmountCents ?? null))
        changes.push({ field: "bonusAmountCents", oldValue: prev.bonusAmountCents, newValue: o.bonusAmountCents });
      if ((prev.offerEndDate?.getTime() ?? null) !== (newEnd?.getTime() ?? null))
        changes.push({ field: "offerEndDate", oldValue: prev.offerEndDate, newValue: newEnd });
      if ((prev.applicationUrl ?? null) !== newAppUrl)
        changes.push({ field: "applicationUrl", oldValue: prev.applicationUrl, newValue: newAppUrl });

      if (changes.length) {
        await db.insert(schema.offerChangeLog).values(
          changes.map((c) => ({
            offerId: prev.id,
            fieldName: c.field,
            oldValue: c.oldValue,
            newValue: c.newValue,
            detectedAt: new Date(),
            detectedByRunId: run.id,
          })),
        );
        offersChanged += changes.length;
      }

      await db
        .update(schema.offer)
        .set({
          bonusAmountCents: o.bonusAmountCents,
          offerEndDate: newEnd,
          extractionConfidence: o.extractionConfidence,
          verificationStatus: o.verificationStatus ?? "unverified",
          affiliateUrl: o.affiliateUrl,
          affiliateNetwork: o.affiliateNetwork,
          applicationUrl: newAppUrl,
          applicationChannel: o.applicationChannel ?? "web",
          signupNotes: o.signupNotes,
          status: "active",
        })
        .where(eq(schema.offer.id, prev.id));
      offersUpdated++;
      skipped++; // requirement tree already exists; don't duplicate
      continue;
    }

    await insertOfferTree(o, institutionId, productId, run.id);
    offersNew++;
  }

  await db
    .update(schema.offerIngestRun)
    .set({
      finishedAt: new Date(),
      offersFound: dataset.length,
      offersNew,
      offersUpdated,
    })
    .where(eq(schema.offerIngestRun.id, run.id));

  return {
    runId: run.id,
    offersFound: dataset.length,
    offersNew,
    offersUpdated,
    offersChanged,
    skipped,
  };
}
