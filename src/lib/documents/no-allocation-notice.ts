/**
 * The notice an invoice issued without an allocation number must carry
 * (ITA v2.0 spec §2.2.2, alternative 2 — "continue the transaction without
 * an allocation number"): the buyer may not deduct input tax against it.
 *
 * Both are the spec's own wordings, word for word: the English edition and
 * the Hebrew edition (`references/vat_software-houses-180724-he.pdf`,
 * §2.2.2, second alternative — "בצורה בולטת", prominently). The ITA's portal
 * paraphrases it ("לא ניתן לנכות…"); the spec is what software must print.
 * Printed and previewed on every design from this one place.
 */
export const NO_ALLOCATION_NOTICE = {
  he: "אין לנכות מס תשומות בגין חשבונית זו",
  en: "Input tax should not be deducted in respect of this invoice",
} as const;

/** Plain reason under the statutory sentence. The sentence itself stays word for word. */
export const NO_ALLOCATION_REASON = {
  he: "לחשבונית אין מספר הקצאה מרשות המסים, ולכן הקונה אינו רשאי לנכות את המע״מ.",
  en: "This invoice has no allocation number from the Tax Authority, so the buyer may not deduct the VAT.",
} as const;

export function noAllocationNotice(language: string | null | undefined): string {
  return language === "en" ? NO_ALLOCATION_NOTICE.en : NO_ALLOCATION_NOTICE.he;
}

export function noAllocationReason(language: string | null | undefined): string {
  return language === "en" ? NO_ALLOCATION_REASON.en : NO_ALLOCATION_REASON.he;
}
