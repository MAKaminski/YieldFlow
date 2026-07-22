"use client";

import { useState, useTransition } from "react";
import { toggleFlagAction } from "./actions";
import type { FlagKey } from "@/lib/flags";

/** A single flag row with an optimistic on/off switch. */
export function FlagToggle({
  flagKey,
  enabled,
}: {
  flagKey: FlagKey;
  enabled: boolean;
}) {
  const [on, setOn] = useState(enabled);
  const [pending, startTransition] = useTransition();

  function toggle() {
    const next = !on;
    setOn(next); // optimistic
    startTransition(async () => {
      try {
        await toggleFlagAction(flagKey, next);
      } catch {
        setOn(!next); // revert on failure
      }
    });
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={`Toggle ${flagKey}`}
      onClick={toggle}
      disabled={pending}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
        on ? "bg-accent" : "bg-edge"
      } ${pending ? "opacity-60" : ""}`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
          on ? "translate-x-6" : "translate-x-1"
        }`}
      />
    </button>
  );
}
