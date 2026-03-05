/**
 * flatDiff — JSON diff utility for form versioning (RFC-0020)
 *
 * Flattens two nested JSON objects into dot-notation paths and returns
 * only the fields that changed, were added, or were removed.
 *
 * Arrays are compared as atomic values (whole array replacement).
 * Nested objects are recursively flattened.
 *
 * Example:
 *   flatDiff(
 *     { delivery: { metodo: "csv", encoding: "utf8" } },
 *     { delivery: { metodo: "dump", dump_banco: "postgresql" } }
 *   )
 *   // →
 *   {
 *     "delivery.metodo":    { from: "csv",  to: "dump" },
 *     "delivery.encoding":  { from: "utf8", to: null },
 *     "delivery.dump_banco":{ from: null,   to: "postgresql" }
 *   }
 */

type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };

function flattenObj(obj: Record<string, JsonValue>, prefix = ''): Record<string, JsonValue> {
  const result: Record<string, JsonValue> = {};
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(result, flattenObj(value as Record<string, JsonValue>, path));
    } else {
      result[path] = value;
    }
  }
  return result;
}

export type DiffEntry = { from: JsonValue; to: JsonValue };

export function flatDiff(
  prev: Record<string, unknown>,
  next: Record<string, unknown>,
): Record<string, DiffEntry> {
  const flatPrev = flattenObj(prev as Record<string, JsonValue>);
  const flatNext = flattenObj(next as Record<string, JsonValue>);

  const allKeys = new Set([...Object.keys(flatPrev), ...Object.keys(flatNext)]);
  const diff: Record<string, DiffEntry> = {};

  for (const key of allKeys) {
    const fromVal = flatPrev[key] ?? null;
    const toVal = flatNext[key] ?? null;
    if (JSON.stringify(fromVal) !== JSON.stringify(toVal)) {
      diff[key] = { from: fromVal, to: toVal };
    }
  }

  return diff;
}
