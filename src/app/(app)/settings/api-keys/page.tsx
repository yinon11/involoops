import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { listApiKeys } from "@/features/generator/actions/api-key-actions";
import { ApiKeysClient } from "@/components/settings/api-keys/api-keys-client";
import { SCOPES } from "@/lib/api/scopes";
import { BookOpen } from "lucide-react";
import { getDictionary } from "@/lib/i18n/server";

export const metadata = {
  title: "API Keys · Settings",
  robots: { index: false, follow: false },
};

export default async function ApiKeysPage() {
  const session = await auth();
  if (!session?.user?.id) notFound();

  const [keys, dict] = await Promise.all([listApiKeys(), getDictionary()]);
  const t = dict.apiKeys.page;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t.title}</h1>
        <p className="text-sm text-gray-500">{t.description}</p>
        <p className="mt-2 text-sm">
          <Link
            href="/developers"
            className="inline-flex items-center gap-1.5 text-indigo-600 hover:underline"
          >
            <BookOpen className="h-4 w-4" />
            {t.readDocs}
          </Link>
        </p>
      </div>

      <ApiKeysClient initialKeys={keys} availableScopes={[...SCOPES]} />
    </div>
  );
}
