export type ResourceCategoryStat = {
  category: string;
  count: number;
  sizeKB: number;
};

function coerceNumber(value: any): number {
  if (value === null || value === undefined) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function normalizeBreakdown(input: any): ResourceCategoryStat[] {
  if (!input) return [];
  if (Array.isArray(input)) {
    return input
      .map((item) => {
        const category = String(item?.category ?? item?.type ?? 'Unknown');
        return {
          category,
          count: coerceNumber(item?.count ?? item?.instances),
          sizeKB: coerceNumber(item?.sizeKB ?? item?.memoryKB ?? item?.size)
        };
      })
      .filter((item) => !!item.category);
  }
  if (typeof input === 'object') {
    return Object.entries(input).map(([category, value]) => ({
      category,
      count: coerceNumber((value as any)?.count ?? (value as any)?.instances ?? value),
      sizeKB: coerceNumber((value as any)?.sizeKB ?? (value as any)?.memoryKB)
    }));
  }
  return [];
}

export function accumulateBreakdown(breakdown: ResourceCategoryStat[]): { totalKB: number; totalCount: number } {
  return breakdown.reduce(
    (acc, item) => {
      acc.totalKB += coerceNumber(item.sizeKB);
      acc.totalCount += coerceNumber(item.count);
      return acc;
    },
    { totalKB: 0, totalCount: 0 }
  );
}
