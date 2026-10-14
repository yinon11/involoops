"use client";

import { createContext, useContext } from "react";

/**
 * The invoice page's issue flow (confirmation modal, ITA refusal dialog,
 * post-issue send prompt), offered to panels rendered inside it — so a
 * panel that owns its own "issue" step runs the same flow as the header
 * button instead of a second copy of it.
 */
export const DocumentIssueContext = createContext<{
  openIssue: () => void;
  issuing: boolean;
} | null>(null);

export function useDocumentIssue() {
  return useContext(DocumentIssueContext);
}
