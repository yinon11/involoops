/**
 * ITA Uniform Structure v1.31 — Appendix 1 document-type catalogue (§5.1).
 * Used for §2.6(b) validation printouts.
 */
export const APPENDIX1_DOCUMENT_TYPES: ReadonlyArray<{
  code: string;
  labelHe: string;
}> = [
  { code: "100", labelHe: "הזמנה" },
  { code: "200", labelHe: "תעודת משלוח" },
  { code: "205", labelHe: "תעודת משלוח סוכן" },
  { code: "210", labelHe: "תעודת החזרה" },
  { code: "300", labelHe: "חשבונית / חשבונית עסקה" },
  { code: "305", labelHe: "חשבונית-מס" },
  { code: "310", labelHe: "חשבונית ריכוז" },
  { code: "320", labelHe: "חשבונית מס / קבלה" },
  { code: "330", labelHe: "חשבונית מס זיכוי" },
  { code: "340", labelHe: "חשבונית שריון" },
  { code: "345", labelHe: "חשבונית סוכן" },
  { code: "400", labelHe: "קבלה" },
  { code: "405", labelHe: "קבלה על תרומות" },
  { code: "410", labelHe: "יציאה מקופה" },
  { code: "420", labelHe: "הפקדת בנק" },
  { code: "500", labelHe: "הזמנת רכש" },
  { code: "600", labelHe: "תעודת משלוח רכש" },
  { code: "610", labelHe: "החזרת רכש" },
  { code: "700", labelHe: "חשבונית מס רכש" },
  { code: "710", labelHe: "זיכוי רכש" },
  { code: "800", labelHe: "יתרת פתיחה" },
  { code: "810", labelHe: "כניסה כללית למלאי" },
  { code: "820", labelHe: "יציאה כללית מהמלאי" },
  { code: "830", labelHe: "העברה בין מחסנים" },
  { code: "840", labelHe: "עדכון בעקבות ספירה" },
  { code: "900", labelHe: "דוח ייצור-כניסה" },
  { code: "910", labelHe: "דוח ייצור-יציאה" },
];
