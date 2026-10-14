/** Walk Drizzle/pg error chain for SQLSTATE codes. */
export function postgresSqlState(err: unknown): string | null {
  let current: unknown = err;
  for (let depth = 0; depth < 6 && current; depth++) {
    if (
      current &&
      typeof current === "object" &&
      "code" in current &&
      typeof (current as { code: unknown }).code === "string"
    ) {
      return (current as { code: string }).code;
    }
    current =
      current &&
      typeof current === "object" &&
      "cause" in current
        ? (current as { cause: unknown }).cause
        : null;
  }
  return null;
}

export function isPostgresMissingColumn(err: unknown): boolean {
  return postgresSqlState(err) === "42703";
}
