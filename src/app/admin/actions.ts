"use server";

import { revalidatePath } from "next/cache";
import { setFlag, type FlagKey } from "@/lib/flags";

// Admin write path — toggle operational feature flags. Revalidates the surfaces
// a flag can affect (the layout nav + the gated pages) so a toggle takes effect
// immediately without a manual refresh.
export async function toggleFlagAction(key: FlagKey, enabled: boolean): Promise<void> {
  await setFlag(key, enabled);
  revalidatePath("/", "layout");
  revalidatePath("/admin");
  revalidatePath("/business");
}
