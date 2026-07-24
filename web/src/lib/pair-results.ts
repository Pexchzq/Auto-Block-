function nonNegativeInteger(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

export function normalizeFinalPairResults(input: {
  directedPairs: unknown;
  blocked: unknown;
  alreadyBlocked: unknown;
  failed: unknown;
}) {
  const directedPairs = nonNegativeInteger(input.directedPairs);
  const blocked = Math.min(nonNegativeInteger(input.blocked), directedPairs);
  const alreadyBlocked = Math.min(
    nonNegativeInteger(input.alreadyBlocked),
    directedPairs - blocked,
  );
  const reportedFailed = Math.min(
    nonNegativeInteger(input.failed),
    directedPairs - blocked - alreadyBlocked,
  );
  const failed = directedPairs - blocked - alreadyBlocked;

  return {
    directedPairs,
    blocked,
    alreadyBlocked,
    failed,
    reportedFailed,
    unaccountedPairs: failed - reportedFailed,
  };
}
