const requiredStages = [
  "flush",
  "compaction",
  "compactionRecall",
  "dreaming",
  "postDreamRecall",
] as const;

/** CLI acceptance only. A failed or missing stage must never exit successfully. */
export function maintenanceExitCode(result: {
  error?: unknown;
  stages?: unknown;
}): 0 | 2 {
  if (result.error || !result.stages || typeof result.stages !== "object")
    return 2;
  const stages = result.stages as Record<string, unknown>;
  return requiredStages.every((name) => stages[name] === "pass") ? 0 : 2;
}
