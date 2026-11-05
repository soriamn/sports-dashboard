import type { z } from "zod";

/**
 * Raised when a provider answers with something we cannot use: an HTTP error,
 * invalid JSON, or a response that does not match the expected schema.
 */
export class AdapterError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "AdapterError";
  }
}

/** Formats a Zod issue path as `events[3].competitions[0].score`. */
export function formatPath(path: readonly PropertyKey[]): string {
  return path.reduce<string>((out, part) => {
    if (typeof part === "number") return `${out}[${part}]`;
    const key = String(part);
    return out === "" ? key : `${out}.${key}`;
  }, "");
}

/**
 * Validates a provider response. On failure it throws an `AdapterError` that
 * names the offending field, e.g.
 * `espn eng.1 scoreboard: invalid field "events[3].status.type.name": ...`.
 */
export function parseResponse<T>(
  schema: z.ZodType<T>,
  data: unknown,
  context: string,
): T {
  const result = schema.safeParse(data);
  if (result.success) return result.data;

  const [first, ...rest] = result.error.issues;
  const more = rest.length > 0 ? ` (and ${rest.length} more)` : "";
  throw new AdapterError(
    `${context}: invalid field "${formatPath(first.path)}": ${first.message}${more}`,
    { cause: result.error },
  );
}
