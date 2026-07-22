import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";

export const dynamic = "force-dynamic";

// GET /api/discovery/status — observability over the discovery pipeline:
// per-source latest ingest run, offer counts by status, and recent changes.
export async function GET() {
  const sources = await db.select().from(schema.offerSource);

  const perSource = await Promise.all(
    sources.map(async (s) => {
      const [run] = await db
        .select()
        .from(schema.offerIngestRun)
        .where(eq(schema.offerIngestRun.offerSourceId, s.id))
        .orderBy(desc(schema.offerIngestRun.createdAt))
        .limit(1);
      return {
        source: s.sourceName,
        trustScore: s.trustScore,
        lastRun: run
          ? {
              status: run.status,
              finishedAt: run.finishedAt,
              offersFound: run.offersFound,
              offersNew: run.offersNew,
              offersUpdated: run.offersUpdated,
            }
          : null,
      };
    }),
  );

  const offers = await db
    .select({ status: schema.offer.status })
    .from(schema.offer);
  const byStatus = offers.reduce<Record<string, number>>((acc, o) => {
    acc[o.status] = (acc[o.status] ?? 0) + 1;
    return acc;
  }, {});

  const recentChanges = await db
    .select({
      offerId: schema.offerChangeLog.offerId,
      field: schema.offerChangeLog.fieldName,
      oldValue: schema.offerChangeLog.oldValue,
      newValue: schema.offerChangeLog.newValue,
      detectedAt: schema.offerChangeLog.detectedAt,
    })
    .from(schema.offerChangeLog)
    .orderBy(desc(schema.offerChangeLog.createdAt))
    .limit(20);

  return NextResponse.json({
    sources: perSource,
    offersByStatus: byStatus,
    recentChanges,
  });
}
