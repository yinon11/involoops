"use client";

import { useRouter } from "next/navigation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useI18n } from "@/lib/i18n/client";

/** `vendor` query value for pending invoices with no linked vendor */
export const PENDING_VENDOR_QUERY_UNLINKED = "unlinked";

type VendorOption = { id: string; name: string };

type PendingVendorFilterProps = {
  vendors: VendorOption[];
  /**
   * Current `vendor` search param: missing/`all`, {@link PENDING_VENDOR_QUERY_UNLINKED},
   * or a vendor uuid.
   */
  selectedVendorParam: string | null;
};

export function PendingVendorFilter({
  vendors,
  selectedVendorParam,
}: PendingVendorFilterProps) {
  const { dict } = useI18n();
  const t = dict.pending.filter;
  const router = useRouter();
  const value = selectedVendorParam ?? "all";

  return (
    <Select
      value={value}
      onValueChange={(next) => {
        const p = new URLSearchParams();
        if (next !== "all") {
          p.set("vendor", next);
        }
        p.set("page", "1");
        router.push(`/pending?${p.toString()}`);
      }}
    >
      <SelectTrigger className="w-[min(100%,260px)] sm:w-[260px]">
        <SelectValue placeholder={t.allVendors} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">{t.allVendors}</SelectItem>
        <SelectItem value={PENDING_VENDOR_QUERY_UNLINKED}>
          {t.vendorNotLinked}
        </SelectItem>
        {vendors.map((v) => (
          <SelectItem key={v.id} value={v.id}>
            {v.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
