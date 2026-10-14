import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { users } from "@/db/schema";
import { lookupInvitationByToken } from "@/actions/team-invitation-actions";
import { getDictionary } from "@/lib/i18n/server";
import { CAPABILITIES, type Capability } from "@/lib/team/capabilities";
import { AutoAccept } from "./auto-accept";

interface PageProps {
  params: Promise<{ token: string }>;
}

export default async function InvitationPage({ params }: PageProps) {
  const { token } = await params;
  const dict = await getDictionary();
  const t = dict.invitePage;

  const session = await auth();
  const invitation = await lookupInvitationByToken(token);

  if (!invitation) {
    return <Status title={t.invalidTitle} body={t.invalidBody} />;
  }
  if (invitation.status === "revoked") {
    return <Status title={t.revokedTitle} body={t.revokedBody} />;
  }
  if (invitation.status === "expired") {
    return <Status title={t.expiredTitle} body={t.expiredBody} />;
  }
  if (invitation.status === "accepted") {
    return <Status title={t.acceptedTitle} body={t.acceptedBody} />;
  }

  const userEmail = session?.user?.email?.toLowerCase() ?? null;
  const inviteEmail = invitation.email.toLowerCase();
  const callbackPath = `/invite/${encodeURIComponent(token)}`;

  // Branch 1: not signed in. Smart-route to login or register based on
  // whether the invited email already has a user record. The user lands on
  // the right page with email + callbackUrl preset, signs in / up, then
  // Auth.js bounces them back here for auto-accept.
  if (!session?.user) {
    const existing = await db.query.users.findFirst({
      where: eq(users.email, inviteEmail),
      columns: { id: true },
    });
    const target = existing ? "/login" : "/register";
    const url = `${target}?callbackUrl=${encodeURIComponent(callbackPath)}&email=${encodeURIComponent(inviteEmail)}`;
    redirect(url);
  }

  // Branch 2: signed in but with the wrong email. Show a clear error so
  // they don't accidentally accept onto the wrong account.
  if (userEmail !== inviteEmail) {
    const owner = invitation.owner;
    const ownerLabel = owner?.companyName?.trim()
      ? owner.companyName.trim()
      : owner?.name?.trim() || owner?.email || "";
    return (
      <Frame title={t.title} subtitle={t.subtitle.replace("{owner}", ownerLabel)}>
        <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">
          {t.wrongAccount.replace("{email}", invitation.email)}
        </p>
        <a
          href={`/api/auth/signout?callbackUrl=${encodeURIComponent(callbackPath)}`}
          className="mt-3 inline-block text-sm text-indigo-600 underline"
        >
          {t.signOutAndRetry}
        </a>
      </Frame>
    );
  }

  // Branch 3: signed in with the matching email — auto-accept and switch
  // straight into the owner's account. The client component fires the
  // server action on mount, refreshes the session JWT, then triggers the
  // switch-account flow so the user lands on the owner's dashboard
  // without needing to open the avatar menu.
  const owner = invitation.owner;
  const ownerLabel = owner?.companyName?.trim()
    ? owner.companyName.trim()
    : owner?.name?.trim() || owner?.email || "";
  const capLabels = invitation.capabilities
    .filter((c): c is Capability =>
      (CAPABILITIES as readonly string[]).includes(c),
    )
    .map((c) => t.capabilities[c]);

  return (
    <Frame title={t.title} subtitle={t.subtitle.replace("{owner}", ownerLabel)}>
      {capLabels.length > 0 && (
        <div className="mb-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t.permissionsLabel}
          </div>
          <ul className="mt-2 list-disc pl-5 text-sm">
            {capLabels.map((label) => (
              <li key={label}>{label}</li>
            ))}
          </ul>
        </div>
      )}
      <AutoAccept
        token={token}
        ownerUserId={invitation.ownerUserId}
        acceptingLabel={t.accepting}
        acceptedLabel={t.accepted}
      />
    </Frame>
  );
}

function Frame({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto max-w-md px-4 py-16">
      <div className="rounded-lg border bg-white p-6 shadow-sm">
        <h1 className="text-xl font-bold">{title}</h1>
        {subtitle && (
          <p className="mt-2 text-sm text-muted-foreground">{subtitle}</p>
        )}
        <div className="mt-4">{children}</div>
      </div>
    </main>
  );
}

function Status({ title, body }: { title: string; body: string }) {
  return (
    <main className="mx-auto max-w-md px-4 py-16">
      <div className="rounded-lg border bg-white p-6 shadow-sm">
        <h1 className="text-xl font-bold">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{body}</p>
      </div>
    </main>
  );
}
