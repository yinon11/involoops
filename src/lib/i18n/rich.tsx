import React from "react";

/**
 * Like `format()`, but the substituted values may be React nodes.
 *
 * Needed for translated sentences that carry inline markup — a bolded button
 * name, a link — where the placeholder cannot be a plain string. Splitting the
 * template rather than hard-coding the surrounding JSX matters for Hebrew:
 * word order differs from English, so the translator has to be free to move
 * the placeholder anywhere in the sentence.
 *
 *   formatRich(t.hint, { action: <strong>{t.save}</strong> })
 *
 * Unknown placeholders are left as-is so missing data stays visible in dev,
 * matching `format()`.
 */
export function formatRich(
  template: string,
  vars: Record<string, React.ReactNode>
): React.ReactNode[] {
  const parts = template.split(/(\{\w+\})/g);
  return parts.map((part, i) => {
    const match = /^\{(\w+)\}$/.exec(part);
    if (match && match[1] in vars) {
      return <React.Fragment key={i}>{vars[match[1]]}</React.Fragment>;
    }
    return <React.Fragment key={i}>{part}</React.Fragment>;
  });
}
