import { Copy } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { getDuplicateInvoiceGroups } from "@/features/expenses/actions/duplicate-actions";
import { DuplicateGroupsList } from "@/features/expenses/components/duplicates/duplicate-groups-list";
import { getDictionary } from "@/lib/i18n/server";
import { ensureCapOrNotFound } from "@/lib/team/enforce";

export default async function DuplicatesPage() {
  await ensureCapOrNotFound("view_invoices");
  const [groups, dict] = await Promise.all([
    getDuplicateInvoiceGroups(),
    getDictionary(),
  ]);
  const t = dict.duplicates.page;
  const totalInvoices = groups.reduce((sum, g) => sum + g.invoices.length, 0);

  const summary =
    groups.length === 1
      ? t.foundOne.replace("{total}", String(totalInvoices))
      : t.foundMany
          .replace("{count}", String(groups.length))
          .replace("{total}", String(totalInvoices));

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Copy className="h-6 w-6 text-rose-500" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t.title}</h1>
          <p className="text-sm text-muted-foreground">{t.subtitle}</p>
        </div>
        <Badge variant="secondary" className="ms-auto text-lg">
          {groups.length}
        </Badge>
      </div>

      {groups.length === 0 ? (
        <div className="rounded-lg border bg-card p-10 text-center shadow-sm">
          <Copy className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
          <p className="text-base font-medium">{t.emptyTitle}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t.emptyBody}</p>
        </div>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">{summary}</p>
          <DuplicateGroupsList groups={groups} />
        </>
      )}
    </div>
  );
}
