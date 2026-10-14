import { dictionaries } from "@/lib/i18n/dictionaries";
import { format } from "@/lib/i18n/format";
import {
  findConsentByToken,
  renderConsentText,
  type ConsentLocale,
} from "@/lib/outbound/reverse-charge-consent";
import { SignatureForm } from "./signature-form";

export const metadata = {
  title: "Reverse-charge consent",
  robots: { index: false, follow: false },
  // The token is in the URL. Nothing on this page links out, but a
  // referrer is still the one place it could leak from.
  referrer: "no-referrer" as const,
};

interface PageProps {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ lang?: string }>;
}

/**
 * Public page where the buyer signs a reverse-charge consent.
 *
 * The language comes from the link, not the visitor's cookie: the buyer
 * has no account here, and the text they sign has to be the text the
 * seller's link said it would be. Switching language re-renders the same
 * snapshot in the other language, and whichever one they sign in is the
 * one that is hashed and stored.
 *
 * Shows only what the buyer is being asked to agree to — the facts frozen
 * in the snapshot when the request was made, never the live invoice.
 */
export default async function ReverseChargeConsentPage({
  params,
  searchParams,
}: PageProps) {
  const { token } = await params;
  const { lang } = await searchParams;
  const locale: ConsentLocale = lang === "en" ? "en" : "he";
  const t = dictionaries[locale].consentPage;
  const dir = locale === "he" ? "rtl" : "ltr";

  const view = await findConsentByToken(token);
  if (!view) {
    return <Status dir={dir} title={t.invalidTitle} body={t.invalidBody} />;
  }
  if (view.state === "signed") {
    const when = view.consent.signedAt?.toISOString().slice(0, 10) ?? "";
    return (
      <Status
        dir={dir}
        title={t.signedTitle}
        body={format(t.signedBody, { date: when })}
      />
    );
  }
  if (view.state === "expired") {
    return <Status dir={dir} title={t.expiredTitle} body={t.expiredBody} />;
  }
  if (view.state === "revoked") {
    return <Status dir={dir} title={t.revokedTitle} body={t.revokedBody} />;
  }
  if (view.state === "stale") {
    return <Status dir={dir} title={t.staleTitle} body={t.staleBody} />;
  }

  const s = view.snapshot;
  const consentText = renderConsentText(locale, s);
  const otherLocale: ConsentLocale = locale === "he" ? "en" : "he";

  return (
    <main dir={dir} className="min-h-screen bg-gray-50 px-4 py-10">
      <div className="mx-auto max-w-2xl space-y-6 rounded-xl border bg-white p-6 shadow-sm sm:p-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold">{t.title}</h1>
            <p className="mt-1 text-sm text-gray-600">
              {format(t.subtitle, { seller: s.seller.name })}
            </p>
          </div>
          <a
            href={`/consent/${encodeURIComponent(token)}?lang=${otherLocale}`}
            className="shrink-0 text-sm text-indigo-600 underline"
          >
            {t.switchLanguage}
          </a>
        </div>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-gray-900">{t.transaction}</h2>
          <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-gray-500">{t.seller}</dt>
              <dd>
                {s.seller.name}
                {s.seller.vatNumber ? ` (${s.seller.vatNumber})` : ""}
              </dd>
            </div>
            <div>
              <dt className="text-gray-500">{t.buyer}</dt>
              <dd>
                {s.buyer.name} ({s.buyer.taxId})
              </dd>
            </div>
            <div>
              <dt className="text-gray-500">{t.date}</dt>
              <dd>{s.invoiceDate}</dd>
            </div>
          </dl>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-gray-500">
                  <th className="py-1 text-start font-normal">{t.description}</th>
                  <th className="px-2 py-1 text-end font-normal">{t.quantity}</th>
                  <th className="px-2 py-1 text-end font-normal">{t.unitPrice}</th>
                  <th className="px-2 py-1 text-end font-normal">{t.lineTotal}</th>
                </tr>
              </thead>
              <tbody>
                {s.items.map((item, i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="py-1">{item.description}</td>
                    <td className="px-2 py-1 text-end">{item.quantity}</td>
                    <td className="px-2 py-1 text-end">{item.unitPrice.toFixed(2)}</td>
                    <td className="px-2 py-1 text-end">{item.total.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={3} className="pt-2 text-end font-semibold">
                    {t.subtotal}
                  </td>
                  <td className="pt-2 text-end font-semibold">
                    {s.subtotal} {s.currency}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-gray-900">
            {t.consentHeading}
          </h2>
          <p className="whitespace-pre-line rounded-md border border-amber-200 bg-amber-50 p-4 text-sm leading-relaxed text-gray-900">
            {consentText}
          </p>
        </section>

        <SignatureForm
          token={token}
          locale={locale}
          buyerName={s.buyer.name}
          sellerName={s.seller.name}
          t={t}
        />
      </div>
    </main>
  );
}

function Status({
  dir,
  title,
  body,
}: {
  dir: "rtl" | "ltr";
  title: string;
  body: string;
}) {
  return (
    <main dir={dir} className="mx-auto max-w-md px-4 py-16">
      <div className="rounded-lg border bg-white p-6 shadow-sm">
        <h1 className="text-xl font-bold">{title}</h1>
        <p className="mt-2 text-sm text-gray-600">{body}</p>
      </div>
    </main>
  );
}
