/**
 * Locale-agnostic helpers used by both server and client code.
 */

/**
 * Replace `{placeholder}` tokens in `template` with values from `vars`.
 * Unknown placeholders are left untouched so missing data is visible in dev.
 */
export function format(
  template: string,
  vars: Record<string, string | number>
): string {
  return template.replace(/\{(\w+)\}/g, (match, key) => {
    return key in vars ? String(vars[key]) : match;
  });
}
