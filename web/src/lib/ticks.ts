/** Round axis ticks (1, 2, 2.5, 5 × 10ⁿ) covering [lo, hi]. */
export function niceTicks(
  lo: number,
  hi: number,
  count = 4,
): { ticks: number[]; domain: [number, number] } {
  const span = hi - lo || Math.abs(hi) || 1;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 2.5, 5, 10].find((m) => m * mag >= raw) ?? 10) * mag;
  const start = Math.floor(lo / step) * step;
  const end = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= end + step / 2; v += step)
    ticks.push(Math.round(v * 100) / 100);
  return { ticks, domain: [start, end] };
}
