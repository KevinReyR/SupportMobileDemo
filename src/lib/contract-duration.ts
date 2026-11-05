export function inclusiveContractDays(start: string | null, end: string | null): number | null {
  const parse = (value: string | null): number | null => {
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const timestamp = Date.parse(`${value}T00:00:00Z`);
    return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value ? timestamp : null;
  };
  const from = parse(start);
  const to = parse(end);
  return from === null || to === null || to < from ? null : (to - from) / 86_400_000 + 1;
}
