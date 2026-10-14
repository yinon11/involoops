/**
 * Cursor pagination helpers. See docs/api/02-conventions.md.
 *
 * The cursor is opaque to clients: base64-url JSON
 * `{ "k": "<sort key>", "id": "<tiebreaker uuid>" }`. Server reads it back
 * to construct a `(sort_key, id) > cursor` SQL condition.
 */

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export interface ParsedCursor {
  k: string;
  id: string;
}

export interface PaginationInput {
  limit: number;
  cursor: ParsedCursor | null;
}

export function parsePaginationParams(url: URL): PaginationInput {
  const rawLimit = url.searchParams.get("limit");
  let limit = rawLimit ? Number(rawLimit) : DEFAULT_LIMIT;
  if (!Number.isFinite(limit) || limit <= 0) limit = DEFAULT_LIMIT;
  if (limit > MAX_LIMIT) limit = MAX_LIMIT;

  const rawCursor = url.searchParams.get("cursor");
  let cursor: ParsedCursor | null = null;
  if (rawCursor) {
    try {
      const json = Buffer.from(rawCursor, "base64url").toString("utf8");
      const obj: unknown = JSON.parse(json);
      if (
        obj &&
        typeof obj === "object" &&
        typeof (obj as ParsedCursor).k === "string" &&
        typeof (obj as ParsedCursor).id === "string"
      ) {
        cursor = obj as ParsedCursor;
      }
    } catch {
      // Bad cursor → start at the top. We don't error on this; clients
      // sometimes mangle URLs and silently restarting the scan is friendly.
      cursor = null;
    }
  }

  return { limit, cursor };
}

export function encodeCursor(c: ParsedCursor): string {
  return Buffer.from(JSON.stringify(c), "utf8").toString("base64url");
}

export interface PageResult<T> {
  data: T[];
  page: {
    next_cursor: string | null;
    has_more: boolean;
    limit: number;
  };
}

/**
 * Given a row set fetched as `limit + 1`, build the page envelope.
 * The "tiebreaker" `id` field on the last row drives the next cursor.
 */
export function buildPage<T extends { id: string }>(
  rows: T[],
  limit: number,
  cursorKey: (row: T) => string,
): PageResult<T> {
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  const last = data[data.length - 1];
  return {
    data,
    page: {
      next_cursor: hasMore && last ? encodeCursor({ k: cursorKey(last), id: last.id }) : null,
      has_more: hasMore,
      limit,
    },
  };
}
