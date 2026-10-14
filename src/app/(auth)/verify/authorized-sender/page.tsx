import type { Metadata } from "next";
import { VerifyAuthorizedSenderClient } from "./verify-authorized-sender-client";

export const metadata: Metadata = {
  title: "Confirm forwarding email",
  description: "Confirm invoice forwarding to an Involoops account.",
  robots: { index: false, follow: false },
};

export default async function VerifyAuthorizedSenderPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; email?: string }>;
}) {
  const { token, email } = await searchParams;
  return (
    <VerifyAuthorizedSenderClient token={token ?? ""} email={email ?? ""} />
  );
}
