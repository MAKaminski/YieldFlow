import { NextResponse } from "next/server";
import { z } from "zod";
import { computeEconomics, feasibilityScore } from "@/lib/yield";

export const dynamic = "force-dynamic";

// GET /api/eligibility?bonusCents=40000&capitalCents=150000&holdDays=90&...
// Pure yield calculator — computes the capital-days economics for a scenario.
const schema = z.object({
  bonusCents: z.coerce.number().int().nonnegative().default(0),
  interestCents: z.coerce.number().int().nonnegative().default(0),
  feesCents: z.coerce.number().int().nonnegative().default(0),
  capitalCents: z.coerce.number().int().positive(),
  holdDays: z.coerce.number().int().positive(),
  marginalRateBps: z.coerce.number().int().min(0).max(10000).default(0),
  ddDifficulty: z
    .enum(["deterministic", "probabilistic", "opaque"])
    .default("deterministic"),
});

export function GET(req: Request) {
  const url = new URL(req.url);
  const parsed = schema.safeParse(Object.fromEntries(url.searchParams));

  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_parameters", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { ddDifficulty, ...inputs } = parsed.data;
  const feasibility = feasibilityScore({ ddDifficulty });
  const economics = computeEconomics({ ...inputs, feasibility });

  return NextResponse.json({ inputs: parsed.data, feasibility, economics });
}
