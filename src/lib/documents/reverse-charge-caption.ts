/**
 * The caption a reverse-charge invoice must carry (ITA v2.0 spec §2.2.2):
 * "The printout will include a caption: 'Customer must self-report this
 * invoice'".
 *
 * Both are the spec's own wordings, word for word: the English edition and
 * the Hebrew edition (`references/vat_software-houses-180724-he.pdf`,
 * §2.2.2, third alternative). The ITA's portal paraphrases it ("הלקוח יוציא
 * חשבונית עצמית"); the spec is what software must print. Every printed and
 * previewed copy reads from this one place.
 */
export const REVERSE_CHARGE_CAPTION = {
  he: "בגין חשבונית זו לקוח חייב לדווח חשבונית עצמית",
  en: "Customer must self-report this invoice",
} as const;

export function reverseChargeCaption(language: string | null | undefined): string {
  return language === "en" ? REVERSE_CHARGE_CAPTION.en : REVERSE_CHARGE_CAPTION.he;
}
