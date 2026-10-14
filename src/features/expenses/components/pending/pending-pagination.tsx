import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type PendingPaginationProps = {
  page: number;
  totalPages: number;
  totalCount: number;
  pageSize: number;
  /** `vendor` query value: vendor uuid, `"unlinked"`, or omit when showing all */
  vendorParam?: string | null;
};

function pageHref(targetPage: number, vendorParam?: string | null) {
  const p = new URLSearchParams();
  p.set("page", String(targetPage));
  if (vendorParam) {
    p.set("vendor", vendorParam);
  }
  return `/pending?${p.toString()}`;
}

export function PendingPagination({
  page,
  totalPages,
  totalCount,
  pageSize,
  vendorParam = null,
}: PendingPaginationProps) {
  if (totalPages <= 1 || totalCount === 0) {
    return null;
  }

  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, totalCount);

  const prevHref = pageHref(page - 1, vendorParam);
  const nextHref = pageHref(page + 1, vendorParam);

  return (
    <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-muted-foreground">
        Showing {from}–{to} of {totalCount}
      </p>
      <div className="flex items-center gap-2">
        <Link
          href={prevHref}
          aria-disabled={page <= 1}
          className={cn(
            buttonVariants({ variant: "outline", size: "sm" }),
            page <= 1 && "pointer-events-none opacity-50",
          )}
        >
          <ChevronLeft className="h-4 w-4" />
          Previous
        </Link>
        <span className="min-w-[5.5rem] text-center text-sm tabular-nums text-muted-foreground">
          Page {page} / {totalPages}
        </span>
        <Link
          href={nextHref}
          aria-disabled={page >= totalPages}
          className={cn(
            buttonVariants({ variant: "outline", size: "sm" }),
            page >= totalPages && "pointer-events-none opacity-50",
          )}
        >
          Next
          <ChevronRight className="h-4 w-4" />
        </Link>
      </div>
    </div>
  );
}
