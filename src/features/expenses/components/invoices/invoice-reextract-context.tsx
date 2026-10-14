"use client";

import { createContext, useContext, type ReactNode } from "react";

export type InvoiceReextractOnComplete = () => void | Promise<void>;

const InvoiceReextractContext = createContext<{
  onComplete?: InvoiceReextractOnComplete;
}>({});

export function InvoiceReextractProvider({
  children,
  onComplete,
}: {
  children: ReactNode;
  onComplete?: InvoiceReextractOnComplete;
}) {
  return (
    <InvoiceReextractContext.Provider value={{ onComplete }}>
      {children}
    </InvoiceReextractContext.Provider>
  );
}

export function useInvoiceReextractContext() {
  return useContext(InvoiceReextractContext);
}
