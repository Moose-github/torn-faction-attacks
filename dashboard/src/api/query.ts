type QueryParamValue = string | number | boolean | null | undefined;

export function queryString(
  params: Record<string, QueryParamValue | readonly QueryParamValue[]>,
): string {
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    const values = Array.isArray(value) ? value : [value];
    for (const item of values) {
      if (item === undefined || item === null) continue;
      search.append(key, typeof item === "boolean" ? (item ? "1" : "0") : String(item));
    }
  }

  return search.size > 0 ? `?${search.toString()}` : "";
}
