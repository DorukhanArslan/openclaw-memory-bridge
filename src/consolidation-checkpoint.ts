/** Select the one verified synthetic daily artifact from an acceptance record. */
export function consolidationCheckpoint(checkpoint: {
  stages?: { flush?: string; extraction?: string };
  afterFlush?: Record<string, unknown>;
}) {
  const candidates = Object.entries(checkpoint.afterFlush ?? {}).flatMap(
    ([path, value]) => {
      const day = /^memory\/(\d{4}-\d{2}-\d{2})\.md$/.exec(path)?.[1];
      if (
        !day ||
        typeof value !== "string" ||
        Buffer.byteLength(value) > 1000 ||
        !/indigo filters every Thursday/i.test(value) ||
        !/synthetic Project Borealis/i.test(value)
      )
        return [];
      const date = new Date(`${day}T00:00:00Z`);
      if (
        !Number.isFinite(date.getTime()) ||
        date.toISOString().slice(0, 10) !== day
      )
        return [];
      return [{ day, note: value }];
    },
  );
  if (
    checkpoint.stages?.flush !== "pass" ||
    checkpoint.stages?.extraction !== "pass" ||
    candidates.length !== 1 ||
    !candidates[0]
  )
    throw new Error(
      "One verified synthetic dated model-note checkpoint is required.",
    );
  return candidates[0];
}
