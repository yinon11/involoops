"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { updateMyBusinessEntity } from "@/features/generator/actions/business-entity-actions";
import {
  INVALID_OSEK_CHECKSUM_MESSAGE,
  INVALID_OSEK_FORMAT_MESSAGE,
  OsekMursheError,
  normalizeOsekMurshe,
} from "@/lib/business-entity/osek-number";
import type {
  BusinessEntityAddress,
  EntityType,
} from "@/db/schema/business-entities";
import { ENTITY_TYPES } from "@/db/schema/business-entities";
import type { Dictionary } from "@/lib/i18n";

interface Props {
  /**
   * Seed values for the form. When the caller has no `business_entities`
   * row yet (first-time setup), this object holds empty strings for the
   * text fields and sensible defaults — the form does not need an `id`
   * because `updateMyBusinessEntity` resolves the caller's entity (or
   * creates one) on the server.
   */
  initial: {
    legalName: string;
    legalNameEn: string;
    osekMurshe: string;
    entityType: EntityType;
    address: BusinessEntityAddress | null;
    phone: string;
    email: string;
    taxYearStartsMonth: number;
    defaultVatInclusive: boolean;
  };
  labels: Dictionary["businessEntity"];
}

export function BusinessEntityForm({ initial, labels }: Props) {
  const [isPending, startTransition] = useTransition();
  const [legalName, setLegalName] = useState(initial.legalName);
  const [legalNameEn, setLegalNameEn] = useState(initial.legalNameEn);
  const [osekMurshe, setOsekMurshe] = useState(initial.osekMurshe);
  const [entityType, setEntityType] = useState<EntityType>(initial.entityType);
  const [street, setStreet] = useState(initial.address?.street ?? "");
  const [city, setCity] = useState(initial.address?.city ?? "");
  const [zip, setZip] = useState(initial.address?.zip ?? "");
  const [country, setCountry] = useState(initial.address?.country ?? "");
  const [phone, setPhone] = useState(initial.phone);
  const [email, setEmail] = useState(initial.email);
  const [taxYearStartsMonth, setTaxYearStartsMonth] = useState(
    initial.taxYearStartsMonth,
  );
  const [defaultVatInclusive, setDefaultVatInclusive] = useState(
    initial.defaultVatInclusive,
  );
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  // Only the 9-digit tax ID (osekMurshe — interpreted per entity
  // type as Osek Murshe / ח.פ. / ע.ר. / partnership number) and the
  // entity type itself are immutable once set. The number ties the
  // tenant to gov.il authorizations and appears on every signed
  // invoice, so it must never change. legalName, address, phone,
  // email, legalNameEn and taxYearStartsMonth remain editable; issued
  // invoices snapshot all of these into documentSignatures, so
  // corrections to the live entity do not alter already-signed
  // documents.
  const lockedOsekMurshe = initial.osekMurshe.trim() !== "";
  const lockedEntityType = lockedOsekMurshe;
  const anyIdentityLocked = lockedOsekMurshe;

  function save() {
    setError(null);
    setSavedAt(null);
    // Spec 09: enforce 9-digit osekMurshe when required by entity
    // type. Tax invoices above threshold without a valid 9-digit
    // number will fail at SHAAM submission time; catching it here
    // surfaces the error inline instead.
    const requiresOsek =
      entityType === "OSEK_MURSHE" ||
      entityType === "CHEVRA_BAAM" ||
      entityType === "AMUTA" ||
      entityType === "SHUTAFUT";
    let osekNormalized = "";
    try {
      const normalized = normalizeOsekMurshe(osekMurshe);
      if (requiresOsek && !normalized) {
        setError(labels.errors.osekRequired);
        return;
      }
      osekNormalized = normalized ?? "";
    } catch (err) {
      if (err instanceof OsekMursheError && err.code === "invalid_checksum") {
        setError(labels.errors.osekChecksum ?? INVALID_OSEK_CHECKSUM_MESSAGE);
        return;
      }
      setError(labels.errors.osekFormat ?? INVALID_OSEK_FORMAT_MESSAGE);
      return;
    }
    startTransition(async () => {
      try {
        const result = await updateMyBusinessEntity({
          legalName: legalName.trim(),
          legalNameEn: legalNameEn.trim(),
          osekMurshe: osekNormalized,
          entityType,
          address: {
            street: street.trim() || undefined,
            city: city.trim() || undefined,
            zip: zip.trim() || undefined,
            country: country.trim() || undefined,
          },
          phone: phone.trim(),
          email: email.trim(),
          taxYearStartsMonth,
          defaultVatInclusive,
        });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setSavedAt(new Date());
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {labels.cardTitle}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {anyIdentityLocked && (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            {labels.identityLockedNotice ??
              "Identity fields are locked once saved to preserve the integrity of invoices already issued. Contact support to correct a mistake."}
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs">{labels.label.legalName}</Label>
            <Input
              value={legalName}
              onChange={(e) => setLegalName(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{labels.label.legalNameEn}</Label>
            <Input
              value={legalNameEn}
              onChange={(e) => setLegalNameEn(e.target.value)}
            />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs">{labels.label.entityType}</Label>
            <Select
              value={entityType}
              onValueChange={(v) => setEntityType(v as EntityType)}
              disabled={lockedEntityType}
            >
              <SelectTrigger className={lockedEntityType ? "bg-gray-100" : undefined}>
                <SelectValue>
                  {labels.entityType[entityType]}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {ENTITY_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {labels.entityType[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">
              {labels.label.identifier[entityType]}
            </Label>
            <Input
              value={osekMurshe}
              onChange={(e) => setOsekMurshe(e.target.value)}
              inputMode="numeric"
              maxLength={9}
              placeholder="123456789"
              className={`font-mono ${lockedOsekMurshe ? "bg-gray-100" : ""}`}
              readOnly={lockedOsekMurshe}
              disabled={lockedOsekMurshe}
            />
            <p className="text-[10px] text-gray-500">
              {labels.label.identifierHint}
            </p>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs">{labels.label.email}</Label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{labels.label.phone}</Label>
            <Input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-4">
          <div className="space-y-1 sm:col-span-2">
            <Label className="text-xs">{labels.label.street}</Label>
            <Input
              value={street}
              onChange={(e) => setStreet(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{labels.label.city}</Label>
            <Input
              value={city}
              onChange={(e) => setCity(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{labels.label.zip}</Label>
            <Input
              value={zip}
              onChange={(e) => setZip(e.target.value)}
            />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label className="text-xs">{labels.label.country}</Label>
            <Input
              value={country}
              onChange={(e) => setCountry(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">
              {labels.label.taxYearStartsMonth}
            </Label>
            <Input
              type="number"
              min={1}
              max={12}
              value={taxYearStartsMonth}
              onChange={(e) =>
                setTaxYearStartsMonth(
                  Math.min(12, Math.max(1, Number(e.target.value) || 1)),
                )
              }
            />
          </div>
        </div>

        <div className="space-y-2 rounded-md border bg-gray-50 p-3">
          <Label className="text-xs font-medium">
            {labels.label.defaultVat}
          </Label>
          <p className="text-[11px] text-gray-500">
            {labels.label.defaultVatHint}
          </p>
          <Select
            value={defaultVatInclusive ? "with" : "without"}
            onValueChange={(v) => setDefaultVatInclusive(v === "with")}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="with">
                {labels.label.defaultVatWith}
              </SelectItem>
              <SelectItem value="without">
                {labels.label.defaultVatWithout}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
        {savedAt && (
          <p className="text-sm text-green-700">
            {labels.saved} {savedAt.toLocaleTimeString()}
          </p>
        )}

        <div>
          <Button onClick={save} disabled={isPending}>
            {isPending ? labels.saving : labels.save}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
