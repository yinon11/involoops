"use client";

import { useState, useCallback } from "react";
import {
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  ExternalLink,
  Pencil,
  Check,
  X,
  Plus,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type {
  VendorTrackingEntry,
} from "@/features/expenses/actions/vendor-actions";
import { useT } from "@/lib/i18n/client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface VendorTrackingClientProps {
  initialData: VendorTrackingEntry[];
  initialMonth: string; // YYYY-MM
  fetchData: (month: string) => Promise<VendorTrackingEntry[]>;
  saveWebsiteUrl: (vendorId: string, url: string | null, slot?: 1 | 2) => Promise<{ success: boolean }>;
}

interface EditingState {
  vendorId: string;
  slot: 1 | 2;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getMonthOptions(): { label: string; value: string }[] {
  const now = new Date();
  const options: { label: string; value: string }[] = [];
  for (let i = -2; i <= 8; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = d.toLocaleDateString("en-US", {
      month: "short",
      year: "numeric",
    });
    options.push({ value, label });
  }
  return options;
}

function formatInvoiceDate(dateStr: string): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatAddedDate(createdAt: Date | string | null): string {
  if (!createdAt) return "";
  const d = typeof createdAt === "string" ? new Date(createdAt) : createdAt;
  return `(added ${d.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  })})`;
}

// ---------------------------------------------------------------------------
// Single link row — reused for slot 1 and slot 2
// ---------------------------------------------------------------------------

function LinkSlot({
  vendorId,
  slot,
  url,
  editing,
  urlDraft,
  setUrlDraft,
  savingUrl,
  onStartEdit,
  onSave,
  onCancel,
}: {
  vendorId: string;
  slot: 1 | 2;
  url: string | null;
  editing: boolean;
  urlDraft: string;
  setUrlDraft: (v: string) => void;
  savingUrl: boolean;
  onStartEdit: (vendorId: string, slot: 1 | 2, currentUrl: string | null) => void;
  onSave: (vendorId: string, slot: 1 | 2) => void;
  onCancel: () => void;
}) {
  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <Input
          value={urlDraft}
          onChange={(e) => setUrlDraft(e.target.value)}
          placeholder="https://..."
          className="h-7 text-xs"
          onKeyDown={(e) => {
            if (e.key === "Enter") onSave(vendorId, slot);
            if (e.key === "Escape") onCancel();
          }}
          autoFocus
        />
        <Button
          size="sm"
          variant="ghost"
          className="h-7 w-7 p-0"
          onClick={() => onSave(vendorId, slot)}
          disabled={savingUrl}
        >
          <Check className="h-3.5 w-3.5 text-green-600" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 w-7 p-0"
          onClick={onCancel}
        >
          <X className="h-3.5 w-3.5 text-gray-400" />
        </Button>
      </div>
    );
  }

  if (url) {
    return (
      <div className="flex items-center gap-1">
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-sm text-indigo-600 hover:text-indigo-800 hover:underline"
        >
          Vendor&apos;s site{slot === 2 ? " 2" : ""}
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 w-7 p-0"
          onClick={() => onStartEdit(vendorId, slot, url)}
        >
          <Pencil className="h-3 w-3 text-gray-400" />
        </Button>
      </div>
    );
  }

  return (
    <button
      onClick={() => onStartEdit(vendorId, slot, null)}
      className="text-sm italic text-gray-400 hover:text-indigo-600"
    >
      Link to be added
    </button>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function VendorTrackingClient({
  initialData,
  initialMonth,
  fetchData,
  saveWebsiteUrl,
}: VendorTrackingClientProps) {
  const t = useT().dashboard.vendorTracking;
  const [data, setData] = useState<VendorTrackingEntry[]>(initialData);
  const [selectedMonth, setSelectedMonth] = useState(initialMonth);
  const [loading, setLoading] = useState(false);
  const [expandedVendors, setExpandedVendors] = useState<Set<string>>(new Set());
  const [editingUrl, setEditingUrl] = useState<EditingState | null>(null);
  const [urlDraft, setUrlDraft] = useState("");
  const [savingUrl, setSavingUrl] = useState(false);

  const monthOptions = getMonthOptions();

  const handleMonthChange = useCallback(
    async (month: string) => {
      setSelectedMonth(month);
      setLoading(true);
      try {
        const newData = await fetchData(month);
        setData(newData);
      } catch (err) {
        console.error("Failed to load vendor tracking data:", err);
      } finally {
        setLoading(false);
      }
    },
    [fetchData]
  );

  const toggleVendor = useCallback((vendorId: string) => {
    setExpandedVendors((prev) => {
      const next = new Set(prev);
      if (next.has(vendorId)) {
        next.delete(vendorId);
      } else {
        next.add(vendorId);
      }
      return next;
    });
  }, []);

  const startEditUrl = useCallback(
    (vendorId: string, slot: 1 | 2, currentUrl: string | null) => {
      setEditingUrl({ vendorId, slot });
      setUrlDraft(currentUrl ?? "");
    },
    []
  );

  const cancelEditUrl = useCallback(() => {
    setEditingUrl(null);
    setUrlDraft("");
  }, []);

  const handleSaveUrl = useCallback(
    async (vendorId: string, slot: 1 | 2) => {
      setSavingUrl(true);
      try {
        await saveWebsiteUrl(vendorId, urlDraft || null, slot);
        const field = slot === 2 ? "websiteUrl2" : "websiteUrl";
        setData((prev) =>
          prev.map((v) =>
            v.vendorId === vendorId
              ? { ...v, [field]: urlDraft || null }
              : v
          )
        );
        setEditingUrl(null);
        setUrlDraft("");
      } catch (err) {
        console.error("Failed to save URL:", err);
      } finally {
        setSavingUrl(false);
      }
    },
    [saveWebsiteUrl, urlDraft]
  );

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">{t.heading}</h2>

      {/* Month selector pills */}
      <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:overflow-visible sm:px-0">
        <div className="flex flex-wrap gap-2">
          {monthOptions.map((opt) => (
            <button
              key={opt.value}
              onClick={() => handleMonthChange(opt.value)}
              className={`rounded-full border px-4 py-1.5 text-sm font-medium transition-colors ${
                selectedMonth === opt.value
                  ? "border-indigo-600 bg-indigo-600 text-white"
                  : "border-gray-300 bg-white text-gray-700 hover:border-indigo-400 hover:bg-indigo-50"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Vendor list */}
      <div
        className={`rounded-lg border bg-white shadow-sm ${loading ? "animate-pulse" : ""}`}
      >
        {/* Header row */}
        <div className="grid grid-cols-[auto_1fr_1fr_250px] items-center gap-4 rounded-t-lg bg-indigo-600 px-4 py-3 text-sm font-semibold text-white">
          <div className="w-6" />
          <div>{t.colVendor}</div>
          <div>{t.colInvoiceCount}</div>
          <div>{t.colLinks}</div>
        </div>

        {data.length === 0 && (
          <div className="flex h-32 items-center justify-center text-muted-foreground">
            {t.empty}
          </div>
        )}

        {data.map((vendor) => {
          const isExpanded = expandedVendors.has(vendor.vendorId);
          const noInvoicesThisMonth = vendor.issuedThisMonth === 0;
          const isEditingSlot1 =
            editingUrl?.vendorId === vendor.vendorId && editingUrl.slot === 1;
          const isEditingSlot2 =
            editingUrl?.vendorId === vendor.vendorId && editingUrl.slot === 2;
          const hasLink1 = !!vendor.websiteUrl;
          const hasLink2 = !!vendor.websiteUrl2;
          const showSecondSlot = hasLink2 || isEditingSlot2;

          return (
            <div
              key={vendor.vendorId}
              className="border-b last:border-b-0"
            >
              {/* Collapsed row */}
              <div
                className={`grid grid-cols-[auto_1fr_1fr_250px] items-center gap-4 px-4 py-3 ${
                  noInvoicesThisMonth ? "bg-amber-50" : ""
                }`}
              >
                {/* Expand toggle */}
                <button
                  onClick={() => toggleVendor(vendor.vendorId)}
                  className="flex h-6 w-6 items-center justify-center rounded text-gray-500 hover:bg-gray-100"
                >
                  {isExpanded ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                </button>

                {/* Vendor name + badge */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => toggleVendor(vendor.vendorId)}
                    className="font-medium text-gray-900 hover:text-indigo-600"
                  >
                    {vendor.vendorName}
                  </button>
                  <Badge className="bg-indigo-600 text-white hover:bg-indigo-600">
                    {vendor.totalInvoiceCount} total
                  </Badge>
                  {noInvoicesThisMonth && (
                    <AlertTriangle className="h-4 w-4 text-amber-500" />
                  )}
                </div>

                {/* Invoice counts */}
                <div className="text-sm text-gray-600">
                  <span className="font-medium text-gray-900">
                    {vendor.issuedThisMonth}
                  </span>{" "}
                  issued this month
                  {" · "}
                  <span className="font-medium text-gray-900">
                    {vendor.uploadedThisMonth}
                  </span>{" "}
                  uploaded this month
                </div>

                {/* Links column */}
                <div className="flex flex-col gap-1">
                  <LinkSlot
                    vendorId={vendor.vendorId}
                    slot={1}
                    url={vendor.websiteUrl}
                    editing={isEditingSlot1}
                    urlDraft={isEditingSlot1 ? urlDraft : ""}
                    setUrlDraft={setUrlDraft}
                    savingUrl={savingUrl}
                    onStartEdit={startEditUrl}
                    onSave={handleSaveUrl}
                    onCancel={cancelEditUrl}
                  />
                  {showSecondSlot && (
                    <LinkSlot
                      vendorId={vendor.vendorId}
                      slot={2}
                      url={vendor.websiteUrl2}
                      editing={isEditingSlot2}
                      urlDraft={isEditingSlot2 ? urlDraft : ""}
                      setUrlDraft={setUrlDraft}
                      savingUrl={savingUrl}
                      onStartEdit={startEditUrl}
                      onSave={handleSaveUrl}
                      onCancel={cancelEditUrl}
                    />
                  )}
                  {hasLink1 && !hasLink2 && !isEditingSlot2 && (
                    <button
                      onClick={() => startEditUrl(vendor.vendorId, 2, null)}
                      className="flex items-center gap-1 text-xs text-gray-400 hover:text-indigo-600"
                    >
                      <Plus className="h-3 w-3" />
                      Add 2nd link
                    </button>
                  )}
                </div>
              </div>

              {/* Expanded panel — recent invoices */}
              {isExpanded && (
                <div className="border-t bg-gray-50 px-8 py-3">
                  {vendor.recentInvoices.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No invoices found for this vendor.
                    </p>
                  ) : (
                    <div className="space-y-1">
                      {vendor.recentInvoices.map((inv) => (
                        <div
                          key={inv.id}
                          className="text-sm text-gray-700"
                        >
                          <span className="font-medium text-indigo-600">
                            {formatInvoiceDate(inv.invoiceDate)}
                          </span>
                          {"  "}
                          <span>
                            {inv.currency} {inv.amount}
                          </span>
                          {inv.invoiceNumber && (
                            <span>
                              {" "}
                              - Invoice #{inv.invoiceNumber}
                            </span>
                          )}
                          {" "}
                          <span className="text-gray-400">
                            {formatAddedDate(inv.createdAt)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
