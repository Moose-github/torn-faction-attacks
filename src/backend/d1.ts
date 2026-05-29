import { d1Changes } from "../utils";

export function d1BatchChanges(results: Iterable<unknown>): number {
  let total = 0;
  for (const result of results) {
    total += d1Changes(result);
  }
  return total;
}
