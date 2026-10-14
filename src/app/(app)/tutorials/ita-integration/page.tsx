import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getDictionary } from "@/lib/i18n/server";
import { auth } from "@/auth";
import { isUserAdmin } from "@/lib/is-user-admin";

export const metadata: Metadata = {
  title: "ITA Integration Tutorial",
  robots: { index: false, follow: false },
};

/**
 * Spec 09 + Spec 11 — tutorial copy. Sections are populated from
 * `dict.onboarding.tutorial.sections`; the prior `TODO(final-copy)`
 * markers are tracked in KNOWN_ISSUES.md under "Documentation
 * backlog" for a marketing/legal pass. An admin-only "DRAFT COPY"
 * watermark is rendered until the text is finalised.
 */
export default async function ItaIntegrationTutorialPage() {
  const [dict, session] = await Promise.all([getDictionary(), auth()]);
  const showDraftWatermark =
    session?.user?.id != null && (await isUserAdmin(session.user.id));

  return (
    <div className="mx-auto max-w-3xl space-y-6 py-4">
      {showDraftWatermark && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-2 text-xs font-medium uppercase tracking-wider text-amber-900">
          DRAFT COPY — pending final pass before external launch
        </div>
      )}
      <header>
        <Link
          href="/tutorials"
          className="text-sm text-indigo-700 hover:underline"
        >
          ← {dict.tutorials.backToList}
        </Link>
        <h1 className="mt-2 text-3xl font-semibold">
          {dict.onboarding.tutorial.title}
        </h1>
        <p className="mt-2 text-muted-foreground">
          {dict.onboarding.tutorial.subtitle}
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>{dict.onboarding.tutorial.sections.what.heading}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-gray-800">
          <p>{dict.onboarding.tutorial.sections.what.body}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{dict.onboarding.tutorial.sections.why.heading}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-gray-800">
          <p>{dict.onboarding.tutorial.sections.why.body}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            {dict.onboarding.tutorial.sections.prerequisites.heading}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-gray-800">
          <ol className="list-decimal space-y-2 ps-5">
            <li>{dict.onboarding.tutorial.sections.prerequisites.azorIshi}</li>
            <li>{dict.onboarding.tutorial.sections.prerequisites.taagid}</li>
            <li>{dict.onboarding.tutorial.sections.prerequisites.morsheAl}</li>
          </ol>
          <p className="text-xs text-gray-500">
            {dict.onboarding.tutorial.sections.prerequisites.note}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            {dict.onboarding.tutorial.sections.oauth.heading}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-gray-800">
          <p>{dict.onboarding.tutorial.sections.oauth.body}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            {dict.onboarding.tutorial.sections.renewal.heading}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-gray-800">
          <p>{dict.onboarding.tutorial.sections.renewal.body}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            {dict.onboarding.tutorial.sections.troubleshooting.heading}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-gray-800">
          <p>{dict.onboarding.tutorial.sections.troubleshooting.body}</p>
        </CardContent>
      </Card>

      <div className="rounded-md border bg-indigo-50 p-4 text-sm">
        <Link
          href="/settings/ita-integration"
          className="font-medium text-indigo-700 hover:underline"
        >
          → {dict.onboarding.tutorial.backToOnboarding}
        </Link>
      </div>
    </div>
  );
}
