"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TemplatePreview, sampleInvoice } from "@/features/generator/components/templates/template-preview";
import { upsertTemplate } from "@/features/generator/actions/template-actions";
import { isValidEmailAddress } from "@/lib/email/address";
import { useI18n } from "@/lib/i18n/client";
import {
  TEMPLATE_DESIGN_IDS,
  TEMPLATE_DESIGN_LABELS,
  coerceDesignId,
  type TemplateConfig,
  type TemplateDesignId,
} from "@/types/template";

export interface TemplateSettingsCardInitial {
  id?: string;
  name?: string | null;
  designId?: string | null;
  accentColor?: string | null;
  /**
   * Stored form. Either `s3:<key>` for uploaded files or a literal
   * URL. The card resolves S3 references to a presigned preview URL on
   * mount so the user sees their saved logo in the live preview.
   */
  logoUrl?: string | null;
  /** Optional already-resolved URL for the preview (presigned). */
  logoPreviewUrl?: string | null;
  businessPhone?: string | null;
  businessEmail?: string | null;
  businessWebsite?: string | null;
  showVatBreakdown?: boolean | null;
  showBankDetails?: boolean | null;
  bankAccountHolder?: string | null;
  bankName?: string | null;
  bankBranch?: string | null;
  bankAccountNumber?: string | null;
  bankIban?: string | null;
  bankSwift?: string | null;
  bankTransferNote?: string | null;
  defaultCurrency?: string | null;
  defaultLanguage?: string | null;
}

/**
 * Issuer identity as a rendered invoice prints it, resolved from the
 * business entity by the page. Read-only here on purpose: the template
 * cannot override it (ITA compliance — see `issuer-identity.ts`).
 */
export interface TemplateIdentity {
  name: string;
  address: string;
  taxId: string;
  /** False when the tenant has not created a business entity yet. */
  hasEntity: boolean;
}

/**
 * Contact values from the business entity, used to seed the template's
 * own phone / email the first time they are edited. Only a seed: once
 * the template holds a value (including a deliberately cleared one) it
 * is what prints, so a tenant can leave a contact off their invoices.
 */
export interface SettingsContact {
  phone: string;
  email: string;
}

interface TemplateSettingsCardProps {
  initialTemplate: TemplateSettingsCardInitial | null;
  identity: TemplateIdentity;
  settingsContact: SettingsContact;
}

export function TemplateSettingsCard({
  initialTemplate,
  identity,
  settingsContact,
}: TemplateSettingsCardProps) {
  const { dict, locale } = useI18n();
  const t = dict.shell.creator.template;
  const [isPending, startTransition] = useTransition();
  const [isUploading, setIsUploading] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Held in a ref so saves stay aligned to a single underlying row even
  // before any prop refresh: the first save returns the new id and we
  // pin to it, so subsequent saves UPDATE rather than INSERT-and-demote.
  const templateIdRef = useRef<string | undefined>(initialTemplate?.id);

  const [designId, setDesignId] = useState<TemplateDesignId>(
    coerceDesignId(initialTemplate?.designId),
  );
  const [accentColor, setAccentColor] = useState(initialTemplate?.accentColor ?? "#6366f1");

  // `logoStored` is what we persist (`s3:<key>` or a literal URL).
  // `logoPreview` is what we render in the preview pane — for S3
  // uploads this is a short-lived presigned URL we get back from the
  // upload route.
  const [logoStored, setLogoStored] = useState<string>(initialTemplate?.logoUrl ?? "");
  const [logoPreview, setLogoPreview] = useState<string>(
    initialTemplate?.logoPreviewUrl ?? initialTemplate?.logoUrl ?? "",
  );
  const [logoUrlInput, setLogoUrlInput] = useState<string>(
    initialTemplate?.logoUrl && !initialTemplate.logoUrl.startsWith("s3:")
      ? initialTemplate.logoUrl
      : "",
  );
  const [logoTab, setLogoTab] = useState<"upload" | "url">(
    initialTemplate?.logoUrl && !initialTemplate.logoUrl.startsWith("s3:") ? "url" : "upload",
  );

  // Seeded from business details only when the template has never held a
  // value (`null`). An empty string means the user cleared the field on
  // purpose, so it stays empty and that contact is simply not printed.
  const [businessPhone, setBusinessPhone] = useState(
    initialTemplate?.businessPhone ?? settingsContact.phone,
  );
  const [businessEmail, setBusinessEmail] = useState(
    initialTemplate?.businessEmail ?? settingsContact.email,
  );
  const [businessWebsite, setBusinessWebsite] = useState(initialTemplate?.businessWebsite ?? "");
  const [showVatBreakdown, setShowVatBreakdown] = useState(
    initialTemplate?.showVatBreakdown ?? true,
  );
  const [showBankDetails, setShowBankDetails] = useState(
    initialTemplate?.showBankDetails ?? false,
  );
  const [bankAccountHolder, setBankAccountHolder] = useState(
    initialTemplate?.bankAccountHolder ?? "",
  );
  const [bankName, setBankName] = useState(initialTemplate?.bankName ?? "");
  const [bankBranch, setBankBranch] = useState(initialTemplate?.bankBranch ?? "");
  const [bankAccountNumber, setBankAccountNumber] = useState(
    initialTemplate?.bankAccountNumber ?? "",
  );
  const [bankIban, setBankIban] = useState(initialTemplate?.bankIban ?? "");
  const [bankSwift, setBankSwift] = useState(initialTemplate?.bankSwift ?? "");
  const [bankTransferNote, setBankTransferNote] = useState(
    initialTemplate?.bankTransferNote ?? "",
  );
  const [defaultCurrency, setDefaultCurrency] = useState(initialTemplate?.defaultCurrency ?? "ILS");
  const [defaultLanguage, setDefaultLanguage] = useState(initialTemplate?.defaultLanguage ?? "he");

  // Auto-clear status messages so they don't linger after the user
  // has visually confirmed the change.
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(null), 4000);
    return () => clearTimeout(t);
  }, [message]);

  // Mirrors `buildTemplateConfig` on the server: identity from the
  // business entity, contacts taken literally from these fields (blank
  // prints nothing). Keeping the two in step is what makes this preview
  // honest.
  const previewConfig: TemplateConfig = {
    designId,
    accentColor,
    logoUrl: logoPreview || null,
    businessName: identity.name || t.identityMissingName,
    businessAddress: identity.address,
    businessTaxId: identity.taxId,
    businessPhone: businessPhone.trim(),
    businessEmail: businessEmail.trim(),
    businessWebsite: businessWebsite.trim(),
    showVatBreakdown,
    showBankDetails,
    bankDetails: {
      accountHolder: bankAccountHolder,
      bankName,
      branch: bankBranch,
      accountNumber: bankAccountNumber,
      iban: bankIban,
      swift: bankSwift,
      note: bankTransferNote,
    },
    defaultCurrency,
    defaultLanguage,
  };

  // Offer the reset only when it would actually change something.
  const canRestoreContact =
    (settingsContact.phone !== "" || settingsContact.email !== "") &&
    (businessPhone !== settingsContact.phone ||
      businessEmail !== settingsContact.email);

  const previewInvoice = {
    ...sampleInvoice,
    currency: defaultCurrency,
    language: defaultLanguage,
  };

  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setMessage({ type: "error", text: t.msg.imageOnly });
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setMessage({ type: "error", text: t.msg.tooLarge });
      return;
    }

    setIsUploading(true);
    try {
      const res = await fetch("/api/upload/logo", {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? t.msg.uploadFailed);
      }
      const { url, storedAs } = (await res.json()) as { url: string; storedAs: string };
      setLogoStored(storedAs);
      setLogoPreview(url);
      setMessage({ type: "success", text: t.msg.uploaded });
    } catch (err) {
      const text = err instanceof Error ? err.message : t.msg.uploadFailed;
      setMessage({ type: "error", text });
    } finally {
      setIsUploading(false);
      // Reset so the same file can be re-selected after a remove.
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function handleApplyUrl() {
    const trimmed = logoUrlInput.trim();
    if (!trimmed) {
      setLogoStored("");
      setLogoPreview("");
      setMessage({ type: "success", text: t.msg.cleared });
      return;
    }
    if (!/^https?:\/\//i.test(trimmed) && !trimmed.startsWith("data:image/")) {
      setMessage({ type: "error", text: t.msg.urlInvalid });
      return;
    }
    setLogoStored(trimmed);
    setLogoPreview(trimmed);
    setMessage({ type: "success", text: t.msg.urlApplied });
  }

  function handleRemoveLogo() {
    setLogoStored("");
    setLogoPreview("");
    setLogoUrlInput("");
  }

  function handleSave() {
    const emailTrimmed = businessEmail.trim();
    if (emailTrimmed && !isValidEmailAddress(emailTrimmed)) {
      setMessage({ type: "error", text: t.msg.invalidBusinessEmail });
      return;
    }
    startTransition(async () => {
      try {
        const saved = await upsertTemplate(
          {
            name: initialTemplate?.name ?? "Default",
            designId,
            accentColor,
            logoUrl: logoStored || null,
            businessPhone,
            businessEmail,
            businessWebsite,
            showVatBreakdown,
            showBankDetails,
            bankAccountHolder,
            bankName,
            bankBranch,
            bankAccountNumber,
            bankIban,
            bankSwift,
            bankTransferNote,
            defaultCurrency,
            defaultLanguage,
          },
          templateIdRef.current,
        );
        if (saved?.id) templateIdRef.current = saved.id;
        setMessage({ type: "success", text: t.msg.saved });
      } catch {
        setMessage({ type: "error", text: t.msg.saveFailed });
      }
    });
  }

  const designLabel =
    TEMPLATE_DESIGN_LABELS[designId][locale === "he" ? "he" : "en"];

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.cardTitle}</CardTitle>
        <CardDescription>{t.cardDescription}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-8 lg:grid-cols-2">
          <div className="space-y-6">
            <div className="space-y-2">
              <Label>{t.designLabel}</Label>
              <Select
                value={designId}
                onValueChange={(v) => setDesignId(coerceDesignId(v))}
              >
                <SelectTrigger>
                  <SelectValue>{designLabel}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {TEMPLATE_DESIGN_IDS.map((id) => (
                    <SelectItem key={id} value={id}>
                      {
                        TEMPLATE_DESIGN_LABELS[id][
                          locale === "he" ? "he" : "en"
                        ]
                      }
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-slate-500">
                {locale === "he"
                  ? TEMPLATE_DESIGN_LABELS[designId].descriptionHe
                  : TEMPLATE_DESIGN_LABELS[designId].description}
              </p>
            </div>

            <div className="space-y-2">
              <Label>{t.accentLabel}</Label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={accentColor}
                  onChange={(e) => setAccentColor(e.target.value)}
                  className="h-10 w-10 cursor-pointer rounded border"
                  aria-label={t.accentAria}
                />
                <Input
                  value={accentColor}
                  onChange={(e) => setAccentColor(e.target.value)}
                  className="w-28"
                  maxLength={7}
                />
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>{t.logoLabel}</Label>
                {logoPreview && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={handleRemoveLogo}
                  >
                    {t.logoRemove}
                  </Button>
                )}
              </div>

              {logoPreview && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={logoPreview}
                  alt={t.logoAlt}
                  className="h-16 w-16 rounded border bg-white object-contain p-1"
                />
              )}

              <Tabs value={logoTab} onValueChange={(v) => setLogoTab(v as "upload" | "url")}>
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="upload">{t.logoTabUpload}</TabsTrigger>
                  <TabsTrigger value="url">{t.logoTabUrl}</TabsTrigger>
                </TabsList>
                <TabsContent value="upload" className="space-y-2 pt-3">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploading}
                  >
                    {isUploading
                      ? t.logoUploadingButton
                      : logoPreview
                        ? t.logoReplaceButton
                        : t.logoUploadButton}
                  </Button>
                  <p className="text-xs text-muted-foreground">{t.logoUploadHint}</p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/svg+xml"
                    onChange={handleLogoUpload}
                    className="hidden"
                  />
                </TabsContent>
                <TabsContent value="url" className="space-y-2 pt-3">
                  <div className="flex gap-2">
                    <Input
                      type="url"
                      placeholder={t.logoUrlPlaceholder}
                      value={logoUrlInput}
                      onChange={(e) => setLogoUrlInput(e.target.value)}
                    />
                    <Button type="button" variant="outline" size="sm" onClick={handleApplyUrl}>
                      {t.logoApplyButton}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">{t.logoUrlHint}</p>
                </TabsContent>
              </Tabs>
            </div>

            <div className="space-y-3">
              <Label className="text-base font-semibold">{t.identitySection}</Label>
              <p className="text-xs text-muted-foreground">{t.identityHint}</p>
              <dl className="space-y-2 rounded-md border bg-muted/40 p-3 text-sm">
                <div className="flex flex-wrap gap-x-2">
                  <dt className="text-muted-foreground">{t.businessNamePh}:</dt>
                  <dd className="font-medium">
                    {identity.name || (
                      <span className="text-muted-foreground">{t.identityUnset}</span>
                    )}
                  </dd>
                </div>
                <div className="flex flex-wrap gap-x-2">
                  <dt className="text-muted-foreground">{t.taxIdPh}:</dt>
                  <dd className="font-mono font-medium">
                    {identity.taxId || (
                      <span className="font-sans text-muted-foreground">
                        {t.identityUnset}
                      </span>
                    )}
                  </dd>
                </div>
                <div className="flex flex-wrap gap-x-2">
                  <dt className="text-muted-foreground">{t.addressPh}:</dt>
                  <dd className="whitespace-pre-line font-medium">
                    {identity.address || (
                      <span className="text-muted-foreground">{t.identityUnset}</span>
                    )}
                  </dd>
                </div>
              </dl>
              <Link
                href="/creator/business-details"
                className="inline-block text-xs font-medium text-primary underline underline-offset-4"
              >
                {identity.hasEntity ? t.identityEditLink : t.identityCreateLink}
              </Link>
            </div>

            <div className="space-y-3">
              <Label className="text-base font-semibold">{t.contactSection}</Label>
              <p className="text-xs text-muted-foreground">{t.contactHint}</p>
              <div className="grid grid-cols-2 gap-3">
                <Input
                  placeholder={t.phonePh}
                  value={businessPhone}
                  onChange={(e) => setBusinessPhone(e.target.value)}
                />
                <Input
                  type="email"
                  placeholder={t.emailPh}
                  value={businessEmail}
                  onChange={(e) => setBusinessEmail(e.target.value)}
                />
              </div>
              <Input
                placeholder={t.websitePh}
                value={businessWebsite}
                onChange={(e) => setBusinessWebsite(e.target.value)}
              />
              {canRestoreContact && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-auto px-0 text-xs font-medium text-primary underline underline-offset-4"
                  onClick={() => {
                    setBusinessPhone(settingsContact.phone);
                    setBusinessEmail(settingsContact.email);
                  }}
                >
                  {t.contactRestore}
                </Button>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{t.currencyLabel}</Label>
                <Select value={defaultCurrency} onValueChange={setDefaultCurrency}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ILS">₪ ILS</SelectItem>
                    <SelectItem value="USD">$ USD</SelectItem>
                    <SelectItem value="EUR">€ EUR</SelectItem>
                    <SelectItem value="GBP">£ GBP</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{t.languageLabel}</Label>
                <Select value={defaultLanguage} onValueChange={setDefaultLanguage}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="he">עברית</SelectItem>
                    <SelectItem value="en">English</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Switch checked={showVatBreakdown} onCheckedChange={setShowVatBreakdown} />
              <Label>{t.showVatToggle}</Label>
            </div>

            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <Switch checked={showBankDetails} onCheckedChange={setShowBankDetails} />
                <Label className="text-base font-semibold">{t.bankSection}</Label>
              </div>
              <p className="text-xs text-muted-foreground">{t.bankHint}</p>
              {showBankDetails && (
                <div className="space-y-3">
                  <Input
                    placeholder={t.bankHolderPh}
                    value={bankAccountHolder}
                    onChange={(e) => setBankAccountHolder(e.target.value)}
                  />
                  <div className="grid grid-cols-3 gap-3">
                    <Input
                      placeholder={t.bankNamePh}
                      value={bankName}
                      onChange={(e) => setBankName(e.target.value)}
                    />
                    <Input
                      placeholder={t.bankBranchPh}
                      value={bankBranch}
                      onChange={(e) => setBankBranch(e.target.value)}
                    />
                    <Input
                      placeholder={t.bankAccountPh}
                      value={bankAccountNumber}
                      onChange={(e) => setBankAccountNumber(e.target.value)}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <Input
                      placeholder={t.bankIbanPh}
                      value={bankIban}
                      onChange={(e) => setBankIban(e.target.value)}
                    />
                    <Input
                      placeholder={t.bankSwiftPh}
                      value={bankSwift}
                      onChange={(e) => setBankSwift(e.target.value)}
                    />
                  </div>
                  <Textarea
                    placeholder={t.bankNotePh}
                    value={bankTransferNote}
                    onChange={(e) => setBankTransferNote(e.target.value)}
                    rows={2}
                  />
                </div>
              )}
            </div>

            {message && (
              <p
                className={`text-sm ${
                  message.type === "success" ? "text-green-600" : "text-red-600"
                }`}
                role="status"
              >
                {message.text}
              </p>
            )}

            <Button onClick={handleSave} disabled={isPending} className="w-full">
              {isPending ? t.savingButton : t.saveButton}
            </Button>
          </div>

          <div className="space-y-2">
            <Label className="text-base font-semibold">{t.previewLabel}</Label>
            <div className="max-h-[700px] overflow-y-auto">
              <TemplatePreview config={previewConfig} invoice={previewInvoice} />
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
