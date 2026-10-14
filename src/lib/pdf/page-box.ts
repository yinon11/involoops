/**
 * A4 print box. The same inset is applied on every page, including the
 * top of a continuation page. The Tax Authority does not set a page
 * margin or a page number; the document number is the required serial.
 * These values only keep the printout off the paper edge.
 */
export const PDF_PAGE = {
  widthMm: 210,
  heightMm: 297,
  marginTopMm: 16,
  marginRightMm: 14,
  marginBottomMm: 18,
  marginLeftMm: 14,
} as const;

export function pdfMarginCss(side: "top" | "right" | "bottom" | "left"): string {
  const mm = {
    top: PDF_PAGE.marginTopMm,
    right: PDF_PAGE.marginRightMm,
    bottom: PDF_PAGE.marginBottomMm,
    left: PDF_PAGE.marginLeftMm,
  }[side];
  return `${mm}mm`;
}

/** Height of the area inside the page margins. */
export function pdfContentHeightMm(): number {
  return PDF_PAGE.heightMm - PDF_PAGE.marginTopMm - PDF_PAGE.marginBottomMm;
}

export function pdfContentWidthMm(): number {
  return PDF_PAGE.widthMm - PDF_PAGE.marginLeftMm - PDF_PAGE.marginRightMm;
}

export function mmToCssPx(mm: number): number {
  return Math.round((mm * 96) / 25.4);
}
