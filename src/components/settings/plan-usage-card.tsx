"use client";

import { useState, useTransition } from "react";

import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  CreditCard,
  Zap,
  Loader2,
  Crown,
  AlertTriangle,
  KeyRound,
  Info,
  Building2,
  UserRound,
  Hash,
} from "lucide-react";
import {
  createUpgradeSession,
  createCancelSession,
  type PlanInfo,
  type AvailableTier,
} from "@/actions/subscription-actions";
import { ENTITY_TYPES, type EntityType } from "@/db/schema/business-entities";
import {
  subscriberCheckoutBillingSchema,
  type SubscriberCheckoutBilling,
} from "@/lib/billing/subscriber-checkout-billing";
import { useI18n } from "@/lib/i18n/client";

interface Props {
  plan: PlanInfo;
  availablePlans: AvailableTier[];
  defaultSubscriberName: string;
  defaultBusinessLegalName: string;
}

const ENTITY_TYPES_LIST = ENTITY_TYPES as readonly EntityType[];

export function PlanUsageCard({
  plan,
  availablePlans,
  defaultSubscriberName,
  defaultBusinessLegalName,
}: Props) {
  const { dict } = useI18n();
  const t = dict.settings.planUsage;
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [showCancel, setShowCancel] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [subscriberName, setSubscriberName] = useState("");
  const [businessLegalName, setBusinessLegalName] = useState("");
  const [registrationScheme, setRegistrationScheme] = useState<
    "business" | "tz"
  >("business");
  const [entityType, setEntityType] = useState<EntityType>("OSEK_MURSHE");
  const [registrationNumber, setRegistrationNumber] = useState("");

  const entityTypeLabels =
    t.upgradeDialog.entityTypes as Record<EntityType, string>;

  function onUpgradeDialogChange(open: boolean) {
    setShowUpgrade(open);
    if (!open) return;
    setSubscriberName(defaultSubscriberName);
    setBusinessLegalName(defaultBusinessLegalName);
    setRegistrationScheme("business");
    setEntityType("OSEK_MURSHE");
    setRegistrationNumber("");
    setError(null);
  }

  const usagePercent = plan.maxInvoices > 0
    ? Math.min(100, Math.round((plan.currentUsage / plan.maxInvoices) * 100))
    : 0;
  const isNearLimit = usagePercent >= 80;
  const isAtLimit = plan.currentUsage >= plan.maxInvoices;
  const isByok = plan.byok === true || plan.status === "byok";
  // BYOK users shouldn't see Stripe upgrade / cancel CTAs — they're on
  // their own key, not a subscription.
  const isFreePlan = !isByok && (plan.tierCode === "free" || plan.status === "free");
  const isPaidActive = !isByok && plan.status === "active" && plan.tierCode !== "free";

  function checkoutBillingPayload(): SubscriberCheckoutBilling {
    return {
      subscriberName,
      businessLegalName,
      registrationScheme,
      entityType: registrationScheme === "business" ? entityType : undefined,
      registrationNumber,
    };
  }

  async function handleUpgrade(tierId: string) {
    setError(null);
    const billing = checkoutBillingPayload();
    const checked = subscriberCheckoutBillingSchema.safeParse(billing);
    if (!checked.success) {
      const issues = checked.error.flatten().fieldErrors;
      if (
        issues.registrationNumber?.length ||
        checked.error.issues.some(
          (i) => i.message === "registration_digit_length",
        )
      ) {
        setError(t.errors.registrationDigits);
        return;
      }
      if (
        issues.entityType?.length ||
        checked.error.issues.some((i) => i.message === "entity_type_required")
      ) {
        setError(t.errors.entityTypeRequired);
        return;
      }
      setError(t.errors.invalidBilling);
      return;
    }

    startTransition(async () => {
      const result = await createUpgradeSession(tierId, checked.data);
      if (result.url) {
        window.location.href = result.url;
      } else if (result.error === "invalid_billing_details") {
        setError(t.errors.invalidBillingServer);
      } else {
        setError(result.error || t.errors.checkoutFailed);
      }
    });
  }

  async function handleCancel() {
    setError(null);
    startTransition(async () => {
      const result = await createCancelSession();
      if (result.url) {
        window.location.href = result.url;
      } else {
        setError(result.error || t.errors.portalFailed);
      }
    });
  }

  const paidPlans = availablePlans.filter((p) => p.code !== "free");

  const formatPriceMonthly = (price: number | string) =>
    t.pricePerMonth.replace("{price}", Number(price).toFixed(2));

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <CreditCard className="h-5 w-5" />
              {t.title}
            </CardTitle>
            <Badge
              variant={isPaidActive || isByok ? "default" : "secondary"}
              className={
                isByok
                  ? "bg-emerald-100 text-emerald-800"
                  : isPaidActive
                    ? "bg-indigo-100 text-indigo-800"
                    : ""
              }
            >
              {isByok ? (
                <KeyRound className="me-1 h-3 w-3" />
              ) : isPaidActive ? (
                <Crown className="me-1 h-3 w-3" />
              ) : null}
              {plan.tierName}
              {isByok && t.byokSuffix}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Usage bar */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                {t.invoicesThisMonth.replace("{yearMonth}", plan.yearMonth)}
              </span>
              <span className={isAtLimit ? "font-semibold text-red-600" : isNearLimit ? "font-semibold text-amber-600" : ""}>
                {plan.currentUsage} / {plan.maxInvoices}
              </span>
            </div>
            <Progress
              value={usagePercent}
              className={`h-2 ${isAtLimit ? "[&>div]:bg-red-500" : isNearLimit ? "[&>div]:bg-amber-500" : ""}`}
            />
            {isAtLimit && (
              <p className="flex items-center gap-1 text-xs text-red-600">
                <AlertTriangle className="h-3 w-3" />
                {t.atLimit}
              </p>
            )}
            {isNearLimit && !isAtLimit && (
              <p className="flex items-center gap-1 text-xs text-amber-600">
                <AlertTriangle className="h-3 w-3" />
                {t.nearLimit}
              </p>
            )}
          </div>

          <Separator />

          {/* Price display */}
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{t.monthlyPrice}</span>
            <span className="font-medium">
              {isByok
                ? t.byokPrice
                : Number(plan.priceMonthly) === 0
                  ? t.free
                  : formatPriceMonthly(plan.priceMonthly)}
            </span>
          </div>

          {isByok && (
            <p className="text-xs text-muted-foreground">{t.byokExplain}</p>
          )}

          {/* Actions */}
          <div className="flex flex-col gap-2">
            {isFreePlan && (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    onClick={() => onUpgradeDialogChange(true)}
                    size="sm"
                    className="bg-indigo-600 hover:bg-indigo-700"
                  >
                    <Zap className="me-1 h-4 w-4" />
                    {t.upgradeButton}
                  </Button>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="h-9 w-9 shrink-0 rounded-full border-muted-foreground/40 text-muted-foreground hover:bg-muted/80 hover:text-foreground"
                        aria-label={t.byokInfo.ariaLabel}
                      >
                        <Info className="h-4 w-4" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-80 text-sm" align="start">
                      <p className="font-medium text-foreground">
                        {t.byokInfo.title}
                      </p>
                      <p className="mt-2 text-muted-foreground">
                        {t.byokInfo.addKeyIn}{" "}
                        <strong className="text-foreground">{t.byokInfo.settings}</strong>{" "}
                        {t.byokInfo.toUseTheApp}{" "}
                        <strong className="text-foreground">{t.byokInfo.freeFromUs}</strong>{" "}
                        {t.byokInfo.onEffective}{" "}
                        <strong className="text-foreground">{t.byokInfo.enterprise}</strong>
                        {t.byokInfo.allowance}{" "}
                        <strong className="text-foreground">{t.byokInfo.invoicesPerMonth}</strong>
                        {t.byokInfo.afterAllowance}{" "}
                        <Link
                          href="/terms"
                          className="font-medium text-indigo-600 underline-offset-2 hover:underline"
                        >
                          {t.byokInfo.tos}
                        </Link>{" "}
                        {t.byokInfo.forFullDetails}
                      </p>
                    </PopoverContent>
                  </Popover>
                </div>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  <span className="text-foreground/70">{t.orUseYourOwnKey}</span>{" "}
                  <Link
                    href="/settings?tab=billing#anthropic-api-key"
                    className="font-medium text-indigo-600 underline-offset-4 hover:underline"
                  >
                    {t.addAnthropicKeyLink}
                  </Link>
                </p>
              </div>
            )}
            {isPaidActive && (
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowCancel(true)}
                >
                  {t.cancelButton}
                </Button>
              </div>
            )}
          </div>

          {error && (
            <p className="text-xs text-red-600">{error}</p>
          )}
        </CardContent>
      </Card>

      {/* Upgrade Dialog */}
      <Dialog open={showUpgrade} onOpenChange={onUpgradeDialogChange}>
        <DialogContent className="left-4 right-4 max-h-[85vh] w-auto max-w-none translate-x-0 overflow-y-auto sm:left-[50%] sm:right-auto sm:w-full sm:max-w-xl sm:translate-x-[-50%]">
          <DialogHeader>
            <DialogTitle>{t.upgradeDialog.title}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <p className="text-xs text-muted-foreground">
              {t.upgradeDialog.billingDetailsHint}
            </p>

            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label
                  htmlFor="checkout-subscriber-name"
                  className="flex items-center gap-2"
                >
                  <UserRound className="text-muted-foreground h-4 w-4 shrink-0" />
                  {t.upgradeDialog.subscriberNameLabel}
                </Label>
                <Input
                  id="checkout-subscriber-name"
                  autoComplete="name"
                  value={subscriberName}
                  onChange={(e) => setSubscriberName(e.target.value)}
                  placeholder={t.upgradeDialog.subscriberNamePlaceholder}
                  disabled={isPending}
                />
              </div>
              <div className="space-y-1.5">
                <Label
                  htmlFor="checkout-business-name"
                  className="flex items-center gap-2"
                >
                  <Building2 className="text-muted-foreground h-4 w-4 shrink-0" />
                  {t.upgradeDialog.businessLegalNameLabel}
                </Label>
                <Input
                  id="checkout-business-name"
                  value={businessLegalName}
                  onChange={(e) => setBusinessLegalName(e.target.value)}
                  placeholder={t.upgradeDialog.businessLegalNamePlaceholder}
                  disabled={isPending}
                />
              </div>
            </div>

            <fieldset className="space-y-2 rounded-md border p-3">
              <legend className="px-1 text-sm font-medium">
                {t.upgradeDialog.registrationTitle}
              </legend>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button
                  type="button"
                  variant={
                    registrationScheme === "business" ? "default" : "outline"
                  }
                  disabled={isPending}
                >
                  {t.upgradeDialog.schemeBusinessLabel}
                </Button>
                <Button
                  type="button"
                  variant={registrationScheme === "tz" ? "default" : "outline"}
                  onClick={() => setRegistrationScheme("tz")}
                  disabled={isPending}
                >
                  {t.upgradeDialog.schemeTzLabel}
                </Button>
              </div>
              {registrationScheme === "business" && (
                <div className="space-y-1.5">
                  <Label>{t.upgradeDialog.entityTypePlaceholder}</Label>
                  <Select
                    value={entityType}
                    onValueChange={(v) => setEntityType(v as EntityType)}
                    disabled={isPending}
                  >
                    <SelectTrigger aria-label={t.upgradeDialog.entityTypePlaceholder}>
                      <SelectValue
                        placeholder={t.upgradeDialog.entityTypePlaceholder}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {ENTITY_TYPES_LIST.map((et) => (
                        <SelectItem key={et} value={et}>
                          {entityTypeLabels[et]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="space-y-1.5">
                <Label
                  htmlFor="checkout-reg-number"
                  className="flex items-center gap-2"
                >
                  <Hash className="text-muted-foreground h-4 w-4 shrink-0" />
                  {t.upgradeDialog.registrationNumberLabel}
                </Label>
                <Input
                  id="checkout-reg-number"
                  inputMode="numeric"
                  autoComplete="off"
                  value={registrationNumber}
                  onChange={(e) => setRegistrationNumber(e.target.value)}
                  placeholder={t.upgradeDialog.registrationNumberPlaceholder}
                  disabled={isPending}
                />
              </div>
            </fieldset>
          </div>

          <Separator className="my-1" />

          <div className="space-y-3">
            {paidPlans.map((tier) => (
              <div
                key={tier.id}
                className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="font-semibold">{tier.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {t.upgradeDialog.upToInvoices.replace(
                      "{count}",
                      String(tier.maxInvoicesPerMonth),
                    )}
                  </p>
                  {tier.features.length > 0 && (
                    <ul className="mt-1 space-y-0.5">
                      {tier.features.map((f, i) => (
                        <li key={i} className="text-xs text-muted-foreground">
                          - {f}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="flex flex-shrink-0 items-center justify-between gap-3 sm:flex-col sm:items-end sm:gap-2">
                  <p className="text-lg font-bold">
                    {t.upgradeDialog.pricePerMonth.replace(
                      "{price}",
                      Number(tier.priceMonthly).toFixed(2),
                    )}
                  </p>
                  <Button
                    size="sm"
                    disabled={isPending || !tier.stripePriceIdMonthly}
                    onClick={() => handleUpgrade(tier.id)}
                  >
                    {isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      t.upgradeDialog.select
                    )}
                  </Button>
                </div>
              </div>
            ))}
            {paidPlans.length === 0 && (
              <p className="py-4 text-center text-sm text-muted-foreground">
                {t.upgradeDialog.noPaidPlans}
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Cancel Dialog */}
      <Dialog open={showCancel} onOpenChange={setShowCancel}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.cancelDialog.title}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{t.cancelDialog.body}</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCancel(false)}>
              {t.cancelDialog.keep}
            </Button>
            <Button
              variant="destructive"
              disabled={isPending}
              onClick={handleCancel}
            >
              {isPending && <Loader2 className="me-1 h-4 w-4 animate-spin" />}
              {t.cancelDialog.continue}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
