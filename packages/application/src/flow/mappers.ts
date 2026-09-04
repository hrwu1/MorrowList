import type { FlowPercentilesDto } from "@morrowlist/contracts";
import { DAY_MS } from "@morrowlist/domain";

/** Milliseconds to days with one decimal, the unit the Flow view and the CLI speak. */
export function toDays(milliseconds: number): number {
  return Math.round((milliseconds / DAY_MS) * 10) / 10;
}

export function toFlowPercentiles(
  samples: number,
  reference: ReadonlyMap<number, number>,
): FlowPercentilesDto {
  const pick = (percentile: number) => {
    const value = reference.get(percentile);
    return value === undefined ? null : toDays(value);
  };
  return { samples, p50: pick(50), p85: pick(85), p95: pick(95) };
}
