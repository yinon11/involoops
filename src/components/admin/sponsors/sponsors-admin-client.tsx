"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, Copy, ImageIcon, Pencil, Plus, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ENTITY_TYPES, type EntityType } from "@/db/schema/business-entities";
import {
  SPONSOR_CATEGORIES,
  SPONSOR_IMAGE_MAX_BYTES,
  SPONSOR_PLACEMENTS,
  SPONSOR_SHARED_FIELDS,
  SPONSOR_TRIGGERS,
  type SponsorSharedField,
} from "@/db/schema/sponsors";
import {
  saveSponsorCampaign,
  setSponsorCampaignActive,
  uploadSponsorImage,
  removeSponsorImage,
  deleteSponsorLead,
  type AdminSponsorCampaign,
  type AdminSponsorLead,
  type SponsorCampaignInput,
} from "@/actions/sponsor-admin-actions";

const TRIGGER_HELP: Record<(typeof SPONSOR_TRIGGERS)[number], string> = {
  everyone:
    "Every user, including those who turned off offer matching. Nothing about the user is checked, so no amount, days or business-type filter.",
  no_accountant: "No accountant connected to the business",
  overdue_receivables: "Unpaid invoices at or above the threshold",
  vat_due: "VAT to set aside this month at or above the threshold",
  revenue_ytd: "Revenue this year at or above the threshold",
};

/**
 * Everything that differs per placement, in one place.
 *
 * `aspect` and `recommended` matter as much as the copy: a campaign has a
 * single image, and each slot crops it to its own shape (`object-cover`), so
 * artwork cut for the dashboard card loses its edges stretched across the top
 * bar. The upload preview below uses `aspect` so what the admin sees here is
 * the shape that actually ships.
 */
const PLACEMENT_SPEC: Record<
  (typeof SPONSOR_PLACEMENTS)[number],
  { label: string; help: string; aspect: string; recommended: string }
> = {
  dashboard: {
    label: "Dashboard card",
    help: "A card on the home dashboard, under \"Needs attention\". The image sits above the title and body text.",
    aspect: "2 / 1",
    recommended: "1200 × 600",
  },
  header: {
    label: "Top bar",
    help: "Fills the top bar of every page, edge to edge (its own slim row on phones). The artwork carries the whole message — the title is not printed beside it, so put the offer in the image.",
    aspect: "12 / 1",
    recommended: "1520 × 128",
  },
  banner: {
    label: "Full-width banner",
    help: "A banner between dashboard sections, with the image beside the offer text.",
    aspect: "3 / 2",
    recommended: "960 × 640",
  },
};

const FIELD_LABEL: Record<SponsorSharedField, string> = {
  name: "Name",
  email: "Email",
  phone: "Phone",
  businessName: "Business name",
  entityType: "Business type",
  openReceivables: "Unpaid invoices total",
};

interface FormState {
  partnerName: string;
  partnerMark: string;
  category: (typeof SPONSOR_CATEGORIES)[number];
  placement: (typeof SPONSOR_PLACEMENTS)[number];
  trigger: (typeof SPONSOR_TRIGGERS)[number];
  minAmount: string;
  entityTypes: EntityType[];
  enTitle: string;
  enBody: string;
  enCta: string;
  heTitle: string;
  heBody: string;
  heCta: string;
  ctaUrl: string;
  sharedFields: SponsorSharedField[];
  weight: string;
  startsAt: string;
  endsAt: string;
}

const EMPTY_FORM: FormState = {
  partnerName: "",
  partnerMark: "",
  category: "accountant",
  placement: "dashboard",
  trigger: "no_accountant",
  minAmount: "",
  entityTypes: [],
  enTitle: "",
  enBody: "",
  enCta: "",
  heTitle: "",
  heBody: "",
  heCta: "",
  ctaUrl: "https://",
  sharedFields: ["name", "email"],
  weight: "0",
  startsAt: "",
  endsAt: "",
};

/** ISO → value for <input type="datetime-local"> in the admin's time zone. */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromCampaign(c: AdminSponsorCampaign): FormState {
  return {
    partnerName: c.partnerName,
    partnerMark: c.partnerMark,
    category: c.category,
    placement: c.placement,
    trigger: c.trigger,
    minAmount: c.minAmount ?? "",
    entityTypes: c.entityTypes ?? [],
    enTitle: c.copy.en?.title ?? "",
    enBody: c.copy.en?.body ?? "",
    enCta: c.copy.en?.cta ?? "",
    heTitle: c.copy.he?.title ?? "",
    heBody: c.copy.he?.body ?? "",
    heCta: c.copy.he?.cta ?? "",
    ctaUrl: c.ctaUrl,
    sharedFields: c.sharedFields,
    weight: String(c.weight),
    startsAt: toLocalInput(c.startsAt),
    endsAt: toLocalInput(c.endsAt),
  };
}

function toInput(f: FormState): SponsorCampaignInput {
  const hasHe = f.heTitle.trim() || f.heBody.trim() || f.heCta.trim();
  return {
    partnerName: f.partnerName,
    partnerMark: f.partnerMark,
    category: f.category,
    placement: f.placement,
    trigger: f.trigger,
    minAmount:
      f.trigger === "no_accountant" || f.trigger === "everyone" || f.minAmount.trim() === ""
        ? null
        : Number(f.minAmount),
    entityTypes: f.trigger !== "everyone" && f.entityTypes.length ? f.entityTypes : null,
    copy: {
      en: { title: f.enTitle, body: f.enBody, cta: f.enCta },
      ...(hasHe ? { he: { title: f.heTitle, body: f.heBody, cta: f.heCta } } : {}),
    },
    ctaUrl: f.ctaUrl,
    sharedFields: f.sharedFields,
    weight: Number(f.weight || 0),
    startsAt: f.startsAt ? new Date(f.startsAt).toISOString() : null,
    endsAt: f.endsAt ? new Date(f.endsAt).toISOString() : null,
  };
}

function csvCell(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function SponsorsAdminClient({
  campaigns,
  leads,
  sponsorsEnabled,
}: {
  campaigns: AdminSponsorCampaign[];
  leads: AdminSponsorLead[];
  sponsorsEnabled: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [editing, setEditing] = useState<{ id?: string; form: FormState } | null>(null);
  const [confirmingLeadId, setConfirmingLeadId] = useState<string | null>(null);
  // Artwork chosen for a campaign that does not exist yet. Held here and
  // uploaded once `save` has an id, so a new campaign can be created with its
  // image in one pass instead of "save, reopen, then upload".
  const [pendingImage, setPendingImage] = useState<{ file: File; preview: string } | null>(null);

  function removeLead(id: string) {
    if (confirmingLeadId !== id) {
      setConfirmingLeadId(id);
      return;
    }
    startTransition(async () => {
      const res = await deleteSponsorLead(id);
      setConfirmingLeadId(null);
      if (!res.ok) toast.error("Could not remove the lead.");
      else toast.success("Lead removed. That user can see the offer again.");
      router.refresh();
    });
  }

  const editingCampaign = editing?.id ? campaigns.find((c) => c.id === editing.id) : undefined;
  // A not-yet-uploaded pick wins over the stored image so the preview always
  // shows what will ship once the campaign is saved.
  const editingImageSrc = pendingImage?.preview ?? editingCampaign?.imageUrl ?? null;

  function clearPendingImage() {
    setPendingImage((prev) => {
      if (prev) URL.revokeObjectURL(prev.preview);
      return null;
    });
  }

  /** Always paired with clearing the buffered pick, so artwork chosen for one
   *  campaign cannot follow the admin into the next one they open. */
  function openEditor(next: { id?: string; form: FormState }) {
    clearPendingImage();
    setEditing(next);
  }

  function closeEditor() {
    clearPendingImage();
    setEditing(null);
  }

  function chooseImage(file: File) {
    // Checked here as well as on the server, so an oversized file is caught at
    // the moment it is picked rather than surfacing much later, at save.
    if (file.size > SPONSOR_IMAGE_MAX_BYTES) {
      toast.error("The image must be 300 KB or smaller");
      return;
    }
    // No campaign yet: hold it until save, so the whole thing lands in one go.
    if (!editing?.id) {
      clearPendingImage();
      setPendingImage({ file, preview: URL.createObjectURL(file) });
      return;
    }
    const fd = new FormData();
    fd.set("image", file);
    startTransition(async () => {
      const res = await uploadSponsorImage(editing.id!, fd);
      if (!res.ok) toast.error(res.error);
      else toast.success("Image saved.");
      router.refresh();
    });
  }

  function removeImage() {
    if (!editing?.id) {
      clearPendingImage();
      return;
    }
    startTransition(async () => {
      await removeSponsorImage(editing.id!);
      router.refresh();
    });
  }

  function toggleActive(c: AdminSponsorCampaign, next: boolean) {
    startTransition(async () => {
      const res = await setSponsorCampaignActive(c.id, next);
      if (!res.ok) toast.error("Could not update the campaign.");
      router.refresh();
    });
  }

  function save() {
    if (!editing) return;
    startTransition(async () => {
      const res = await saveSponsorCampaign(toInput(editing.form), editing.id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      // The campaign exists now, so any artwork picked before it had an id can
      // go up. A failure here leaves the campaign saved but imageless, which is
      // recoverable by reopening it — so it warns rather than blocking.
      if (pendingImage) {
        const fd = new FormData();
        fd.set("image", pendingImage.file);
        const up = await uploadSponsorImage(res.id, fd);
        if (!up.ok) toast.error(`Campaign saved, but the image did not: ${up.error}`);
      }
      toast.success(editing.id ? "Campaign saved." : "Campaign created. It stays off until you switch it on.");
      closeEditor();
      router.refresh();
    });
  }

  async function copyLeadsCsv() {
    const header = ["date", "partner", "account_email", ...SPONSOR_SHARED_FIELDS];
    const lines = leads.map((l) =>
      [
        l.createdAt,
        l.partnerName,
        l.userEmail,
        ...SPONSOR_SHARED_FIELDS.map((f) => l.sharedData[f] ?? ""),
      ]
        .map(csvCell)
        .join(","),
    );
    try {
      await navigator.clipboard.writeText([header.join(","), ...lines].join("\n"));
      toast.success(`Copied ${leads.length} leads as CSV.`);
    } catch {
      toast.error("Could not copy to the clipboard.");
    }
  }

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setEditing((e) => (e ? { ...e, form: { ...e.form, [key]: value } } : e));

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold text-zinc-900">Sponsors</h1>
          <p className="text-sm text-zinc-500">
            Partner offers shown on the home dashboard or in the top bar to users whose
            numbers match the campaign&apos;s trigger. Stats cover the last 30 days.
          </p>
        </div>
        <Button onClick={() => openEditor({ form: EMPTY_FORM })}>
          <Plus className="me-1.5 h-4 w-4" />
          New campaign
        </Button>
      </header>

      {!sponsorsEnabled ? (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Sponsored offers are switched off for this deployment. Set{" "}
            <code className="font-mono">SPONSORS_ENABLED=true</code> to show
            active campaigns.
          </span>
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Campaigns</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          {campaigns.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-zinc-500">
              No campaigns yet. Create one; it starts switched off.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Partner</TableHead>
                  <TableHead>Trigger</TableHead>
                  <TableHead className="text-end">Shown</TableHead>
                  <TableHead className="text-end">Hidden</TableHead>
                  <TableHead className="text-end">Leads</TableHead>
                  <TableHead>Live</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {campaigns.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>
                      <div className="flex items-center gap-2 font-medium">
                        {c.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={c.imageUrl} alt="" className="h-6 w-12 rounded object-cover" />
                        ) : null}
                        {c.partnerName}
                      </div>
                      <div className="text-xs text-zinc-500">
                        {PLACEMENT_SPEC[c.placement].label} · {c.category} · weight {c.weight}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{c.trigger}</Badge>
                      {c.minAmount ? (
                        <span className="ms-2 text-xs tabular-nums text-zinc-500">
                          ≥ ₪{Number(c.minAmount).toLocaleString()}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-end tabular-nums">{c.stats.impressions}</TableCell>
                    <TableCell className="text-end tabular-nums">{c.stats.dismissals}</TableCell>
                    <TableCell className="text-end tabular-nums">{c.stats.leads}</TableCell>
                    <TableCell>
                      <Switch
                        checked={c.isActive}
                        disabled={isPending}
                        onCheckedChange={(v) => toggleActive(c, v)}
                        aria-label={`${c.isActive ? "Switch off" : "Switch on"} ${c.partnerName}`}
                      />
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openEditor({ id: c.id, form: fromCampaign(c) })}
                      >
                        <Pencil className="me-1 h-3.5 w-3.5" />
                        Edit
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <div>
            <CardTitle className="text-base">Leads</CardTitle>
            <p className="mt-1 text-xs text-zinc-500">
              Details each user confirmed sharing. Removing a lead lets that user see the offer again (for testing). Personal data: share only
              with the partner the user chose.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={copyLeadsCsv} disabled={leads.length === 0}>
            <Copy className="me-1.5 h-3.5 w-3.5" />
            Copy as CSV
          </Button>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          {leads.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-zinc-500">No leads yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Partner</TableHead>
                  <TableHead>Shared details</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {leads.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="whitespace-nowrap text-xs tabular-nums">
                      {new Date(l.createdAt).toLocaleString()}
                    </TableCell>
                    <TableCell>{l.partnerName}</TableCell>
                    <TableCell className="text-xs">
                      {Object.entries(l.sharedData).map(([k, v]) => (
                        <div key={k}>
                          <span className="text-zinc-500">
                            {FIELD_LABEL[k as SponsorSharedField] ?? k}:
                          </span>{" "}
                          <span dir="auto">{v}</span>
                        </div>
                      ))}
                    </TableCell>
                    <TableCell className="text-end">
                      <Button
                        variant={confirmingLeadId === l.id ? "destructive" : "ghost"}
                        size="sm"
                        disabled={isPending}
                        onClick={() => removeLead(l.id)}
                        onBlur={() => setConfirmingLeadId((c) => (c === l.id ? null : c))}
                      >
                        <Trash2 className="me-1 h-3.5 w-3.5" />
                        {confirmingLeadId === l.id ? "Confirm remove" : "Remove"}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={editing != null} onOpenChange={(o) => (o ? null : closeEditor())}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing?.id ? "Edit campaign" : "New campaign"}</DialogTitle>
          </DialogHeader>
          {editing ? (
            <form
              className="space-y-5"
              onSubmit={(e) => {
                e.preventDefault();
                save();
              }}
            >
              <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
                <Field label="Partner name" id="sp-name">
                  <Input id="sp-name" value={editing.form.partnerName} onChange={(e) => set("partnerName", e.target.value)} required maxLength={120} />
                </Field>
                <Field label="Mark (1–3 chars)" id="sp-mark">
                  <Input id="sp-mark" value={editing.form.partnerMark} onChange={(e) => set("partnerMark", e.target.value)} required maxLength={3} />
                </Field>
              </div>

              {/* Placement comes before the image: it decides the shape the
                  artwork is cropped to, so it has to be chosen first. */}
              <Field label="Placement" id="sp-placement" hint={PLACEMENT_SPEC[editing.form.placement].help}>
                <NativeSelect id="sp-placement" value={editing.form.placement} options={SPONSOR_PLACEMENTS} onChange={(v) => set("placement", v)} />
              </Field>

              <fieldset className="space-y-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
                <legend className="px-1 text-sm font-medium">Image</legend>
                {editingImageSrc ? (
                  // Previewed in the placement's own shape, so cropping that
                  // would happen on the page is visible here first.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={editingImageSrc}
                    alt="Campaign artwork"
                    className="w-full max-w-sm rounded-lg bg-zinc-100 object-cover"
                    style={{ aspectRatio: PLACEMENT_SPEC[editing.form.placement].aspect }}
                  />
                ) : (
                  <div
                    className="flex w-full max-w-sm items-center justify-center rounded-lg border border-dashed border-zinc-300 text-zinc-400"
                    style={{ aspectRatio: PLACEMENT_SPEC[editing.form.placement].aspect }}
                  >
                    <ImageIcon className="h-6 w-6" />
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <Label htmlFor="sp-image" className="sr-only">Upload image</Label>
                  <Input
                    id="sp-image"
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    disabled={isPending}
                    className="max-w-xs"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) chooseImage(f);
                      e.target.value = "";
                    }}
                  />
                  {editingImageSrc ? (
                    <Button type="button" variant="ghost" size="sm" onClick={removeImage} disabled={isPending}>
                      <Trash2 className="me-1 h-3.5 w-3.5" />
                      Remove
                    </Button>
                  ) : null}
                </div>
                <p className="text-xs text-zinc-500">
                  PNG, JPEG or WebP, up to 300 KB. Cropped to{" "}
                  {PLACEMENT_SPEC[editing.form.placement].aspect.replace(/\s/g, "")} for the{" "}
                  {PLACEMENT_SPEC[editing.form.placement].label.toLowerCase()} —{" "}
                  {PLACEMENT_SPEC[editing.form.placement].recommended} works well.{" "}
                  {editing.id ? "Saved straight away." : "Uploaded when you create the campaign."}
                </p>
              </fieldset>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Category" id="sp-cat">
                  <NativeSelect id="sp-cat" value={editing.form.category} options={SPONSOR_CATEGORIES} onChange={(v) => set("category", v)} />
                </Field>
                <Field label="Weight (higher wins)" id="sp-weight">
                  <Input id="sp-weight" type="number" min={0} max={1000} value={editing.form.weight} onChange={(e) => set("weight", e.target.value)} />
                </Field>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Trigger" id="sp-trigger" hint={TRIGGER_HELP[editing.form.trigger]}>
                  <NativeSelect id="sp-trigger" value={editing.form.trigger} options={SPONSOR_TRIGGERS} onChange={(v) => set("trigger", v)} />
                </Field>
                {editing.form.trigger !== "no_accountant" && editing.form.trigger !== "everyone" ? (
                  <Field label="Threshold (ILS)" id="sp-min">
                    <Input id="sp-min" type="number" min={0} step="1" value={editing.form.minAmount} onChange={(e) => set("minAmount", e.target.value)} />
                  </Field>
                ) : null}
              </div>

              {editing.form.trigger !== "everyone" ? (
                <fieldset className="space-y-2">
                  <legend className="text-sm font-medium">Business types (none = all)</legend>
                  <CheckboxRow
                    options={ENTITY_TYPES}
                    selected={editing.form.entityTypes}
                    onChange={(v) => set("entityTypes", v)}
                    idPrefix="sp-et"
                  />
                </fieldset>
              ) : null}

              <CopyFields lang="en" label="English copy (required)" form={editing.form} set={set} />
              <CopyFields lang="he" label="Hebrew copy (optional, falls back to English)" form={editing.form} set={set} />
              <p className="text-xs text-zinc-500">
                Use <code>{"{amount}"}</code> for the matched amount and{" "}
                <code>{"{days}"}</code> for the age of the oldest unpaid invoice.
              </p>

              <Field label="Partner link (https only)" id="sp-url">
                <Input id="sp-url" type="url" value={editing.form.ctaUrl} onChange={(e) => set("ctaUrl", e.target.value)} required />
              </Field>

              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">Details shared when a user confirms</legend>
                <p className="text-xs text-zinc-500">
                  Ask only for what the partner needs to follow up. Users see the
                  exact values before they confirm.
                </p>
                <CheckboxRow
                  options={SPONSOR_SHARED_FIELDS}
                  selected={editing.form.sharedFields}
                  onChange={(v) => set("sharedFields", v)}
                  labels={FIELD_LABEL}
                  idPrefix="sp-sf"
                />
              </fieldset>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Starts (optional)" id="sp-start">
                  <Input id="sp-start" type="datetime-local" value={editing.form.startsAt} onChange={(e) => set("startsAt", e.target.value)} />
                </Field>
                <Field label="Ends (optional)" id="sp-end">
                  <Input id="sp-end" type="datetime-local" value={editing.form.endsAt} onChange={(e) => set("endsAt", e.target.value)} />
                </Field>
              </div>

              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={closeEditor} disabled={isPending}>
                  Cancel
                </Button>
                <Button type="submit" disabled={isPending}>
                  {editing.id ? "Save" : "Create (switched off)"}
                </Button>
              </div>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({
  label,
  id,
  hint,
  children,
}: {
  label: string;
  id: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-zinc-500">{hint}</p> : null}
    </div>
  );
}

function NativeSelect<T extends string>({
  id,
  value,
  options,
  onChange,
}: {
  id: string;
  value: T;
  options: readonly T[];
  onChange: (v: T) => void;
}) {
  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
    >
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

function CheckboxRow<T extends string>({
  options,
  selected,
  onChange,
  labels,
  idPrefix,
}: {
  options: readonly T[];
  selected: T[];
  onChange: (v: T[]) => void;
  labels?: Record<T, string>;
  idPrefix: string;
}) {
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-2">
      {options.map((o) => {
        const id = `${idPrefix}-${o}`;
        return (
          <label key={o} htmlFor={id} className="inline-flex items-center gap-2 text-sm">
            <input
              id={id}
              type="checkbox"
              checked={selected.includes(o)}
              onChange={(e) =>
                onChange(e.target.checked ? [...selected, o] : selected.filter((s) => s !== o))
              }
            />
            {labels?.[o] ?? o}
          </label>
        );
      })}
    </div>
  );
}

function CopyFields({
  lang,
  label,
  form,
  set,
}: {
  lang: "en" | "he";
  label: string;
  form: FormState;
  set: <K extends keyof FormState>(key: K, value: FormState[K]) => void;
}) {
  const k = (s: "Title" | "Body" | "Cta") => `${lang}${s}` as const;
  const dir = lang === "he" ? "rtl" : "ltr";
  const required = lang === "en";
  return (
    <fieldset className="space-y-3 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
      <legend className="px-1 text-sm font-medium">{label}</legend>
      <Field label="Title" id={`sp-${lang}-title`}>
        <Input id={`sp-${lang}-title`} dir={dir} value={form[k("Title")]} onChange={(e) => set(k("Title"), e.target.value)} required={required} maxLength={140} />
      </Field>
      <Field label="Body" id={`sp-${lang}-body`}>
        <Textarea id={`sp-${lang}-body`} dir={dir} rows={2} value={form[k("Body")]} onChange={(e) => set(k("Body"), e.target.value)} required={required} maxLength={400} />
      </Field>
      <Field label="Button text" id={`sp-${lang}-cta`}>
        <Input id={`sp-${lang}-cta`} dir={dir} value={form[k("Cta")]} onChange={(e) => set(k("Cta"), e.target.value)} required={required} maxLength={40} />
      </Field>
    </fieldset>
  );
}
