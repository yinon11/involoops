"use client";

import {
  useEffect,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useI18n } from "@/lib/i18n/client";
import { format } from "@/lib/i18n";
import { Switch } from "@/components/ui/switch";
import {
  removeReverseCharge,
  requestReverseChargeConsent,
  switchOnReverseCharge,
} from "@/features/generator/actions/reverse-charge-consent-actions";
import { useDocumentIssue } from "./document-issue-context";
import {
  ArrowLeftRight,
  Check,
  FileSignature,
  Loader2,
} from "lucide-react";

export interface ReverseChargeConsentSummary {
  state: "pending" | "expired" | "signed" | "revoked" | "stale";
  recipientEmail: string;
  expiresAt: string;
  signerName: string | null;
  signerRole: string | null;
  signedAt: string | null;
  signerIp: string | null;
}

interface Props {
  documentId: string;
  isDraft: boolean;
  reverseCharge: boolean;
  vatIsZero: boolean;
  customerTaxIdValid: boolean;
  customerEmail: string | null;
  consent: ReverseChargeConsentSummary | null;
  /** The acknowledgement text, in the seller's language, at the version stored with the request. */
  sellerAcknowledgement: string;
  statutoryVatRate: number;
  canManage: boolean;
  /** The ITA refused or holds this draft: issuing will send action 3 (route B). */
  afterRefusal: boolean;
  /** An invoice-receipt keeps 0% VAT when reverse charge is removed. */
  isInvoiceReceipt: boolean;
  /** The document type's name, for the issue button. */
  documentTypeLabel: string;
  /** Route B: this is the zero-VAT invoice that replaces a refused one. */
  replaces: LinkedInvoice | null;
  /** Route B: this refused invoice is being replaced by that one. */
  replacedBy: LinkedInvoice | null;
}

interface LinkedInvoice {
  id: string;
  formattedNumber: string | null;
}

/** How often the page checks whether the buyer has signed, while waiting. */
const SIGNATURE_POLL_MS = 8_000;

function Step({
  n,
  title,
  state,
  children,
}: {
  n: number;
  title: string;
  state: "done" | "current" | "locked";
  children: ReactNode;
}) {
  return (
    <li className="flex gap-3">
      <span
        className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
          state === "done"
            ? "bg-emerald-600 text-white"
            : state === "current"
              ? "bg-indigo-600 text-white"
              : "bg-slate-200 text-slate-500"
        }`}
      >
        {state === "done" ? <Check className="h-3.5 w-3.5" /> : n}
      </span>
      <div className="min-w-0 flex-1 space-y-2">
        <p
          className={`font-medium ${state === "locked" ? "text-muted-foreground" : ""}`}
        >
          {title}
        </p>
        {children}
      </div>
    </li>
  );
}


/**
 * Reverse charge on the invoice page: a switch that makes the draft a
 * reverse-charge invoice (VAT → 0), then two steps — the buyer signs, then
 * the seller issues. While the switch is on, this card is the only place
 * to issue from: the page's header hides its issue button, so a draft is
 * never offered as both kinds of invoice at once.
 *
 * Issuing re-checks all of it server-side; this panel only says what the
 * server will say, before the click.
 */
export function ReverseChargePanel({
  documentId,
  isDraft,
  reverseCharge,
  vatIsZero,
  customerTaxIdValid,
  customerEmail,
  consent,
  sellerAcknowledgement,
  statutoryVatRate,
  canManage,
  afterRefusal,
  isInvoiceReceipt,
  documentTypeLabel,
  replaces,
  replacedBy,
}: Props) {
  const router = useRouter();
  const { dict } = useI18n();
  const t = dict.reverseCharge;
  const issue = useDocumentIssue();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [email, setEmail] = useState(customerEmail ?? "");
  const [created, setCreated] = useState<{
    link: string;
    expiresAt: string;
    recipientEmail: string;
    emailSent: boolean;
    emailError?: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);

  const consentState = consent?.state;

  // While the buyer's signature is out, watch for it: re-render the page's
  // server data on an interval so the signature shows up — and the issue
  // step unlocks — without the seller having to know to refresh.
  useEffect(() => {
    if (!isDraft || consentState !== "pending") return;
    const id = setInterval(() => {
      if (!document.hidden) router.refresh();
    }, SIGNATURE_POLL_MS);
    return () => clearInterval(id);
  }, [isDraft, consentState, router]);

  // The moment the watched signature arrives, say so.
  const prevConsentState = useRef(consentState);
  useEffect(() => {
    if (prevConsentState.current === "pending" && consentState === "signed") {
      toast.success(t.signedToast);
    }
    prevConsentState.current = consentState;
  }, [consentState, t.signedToast]);

  if (!isDraft && !reverseCharge) return null;

  // A replacement's consent and reverse charge belong to the original:
  // they are managed there (switching off on the original discards an
  // unissued replacement), not here. A replacement that holds a number is
  // past undoing.
  const manageable = canManage && !replaces && !replacedBy?.formattedNumber;

  const day = (iso: string | null) => (iso ? iso.slice(0, 10) : "");
  const signed = consent?.state === "signed";
  const on = reverseCharge;

  function toggle(next: boolean) {
    if (!next) {
      const question = isInvoiceReceipt
        ? t.confirmRemoveReceipt
        : format(t.confirmRemove, { rate: statutoryVatRate });
      if (!confirm(question)) return;
    }
    setError(null);
    startTransition(async () => {
      const res = next
        ? await switchOnReverseCharge(documentId)
        : await removeReverseCharge(documentId);
      if (!res.ok) setError(res.error);
      router.refresh();
    });
  }

  function repairVat() {
    setError(null);
    startTransition(async () => {
      const res = await switchOnReverseCharge(documentId);
      if (!res.ok) setError(res.error);
      router.refresh();
    });
  }

  // On success the dialog stays open and flips to a confirmation view —
  // the link (the fallback when the email fails) must survive long enough
  // to be copied. The page data refreshes only when the dialog closes, at
  // which point the steps take over.
  function send() {
    setError(null);
    startTransition(async () => {
      const res = await requestReverseChargeConsent({
        documentId,
        sellerAcknowledged: acknowledged,
        recipientEmail: email || null,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setCreated(res);
      setAcknowledged(false);
    });
  }

  function handleDialogOpenChange(open: boolean) {
    setDialogOpen(open);
    if (!open && created) {
      setCreated(null);
      setCopied(false);
      router.refresh();
    }
  }

  async function copyLink() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.link);
      setCopied(true);
    } catch {
      // Clipboard can be blocked; the link is on screen to copy by hand.
    }
  }

  const requestDialog = (
    <Dialog open={dialogOpen} onOpenChange={handleDialogOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t.dialogTitle}</DialogTitle>
        </DialogHeader>
        {created ? (
          // min-w-0: the dialog is a grid whose column otherwise grows to
          // the link's full, unbreakable width and spills out of the box.
          <div className="min-w-0 space-y-3 text-sm">
            <p>{format(t.linkReady, { date: day(created.expiresAt) })}</p>
            <p>
              {created.emailSent
                ? format(t.emailSent, { email: created.recipientEmail })
                : format(t.emailFailed, { error: created.emailError ?? "" })}
            </p>
            <div className="flex min-w-0 items-center gap-2 rounded-md border bg-slate-50 p-2">
              <code className="min-w-0 flex-1 truncate text-xs" dir="ltr" title={created.link}>
                {created.link}
              </code>
              <Button size="sm" variant="outline" className="shrink-0" onClick={copyLink}>
                {copied ? t.copied : t.copy}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4 text-sm">
            <p className="text-muted-foreground">{t.convertNote}</p>
            {!customerTaxIdValid && (
              <p className="rounded-md bg-amber-50 p-2 text-amber-900">
                {t.needsTaxId}
              </p>
            )}
            <label className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-950">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4"
                checked={acknowledged}
                onChange={(e) => setAcknowledged(e.target.checked)}
              />
              <span>
                <strong>{t.ackLabel}</strong> {sellerAcknowledgement}
              </span>
            </label>
            <div className="space-y-1">
              <Label htmlFor="rc-email">{t.emailLabel}</Label>
              <Input
                id="rc-email"
                type="email"
                dir="ltr"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            {error && (
              <p className="rounded-md bg-red-50 p-2 text-red-700">{error}</p>
            )}
          </div>
        )}
        <DialogFooter>
          {created ? (
            <Button onClick={() => handleDialogOpenChange(false)}>
              {t.close}
            </Button>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={() => setDialogOpen(false)}
                disabled={isPending}
              >
                {t.cancel}
              </Button>
              <Button
                onClick={send}
                disabled={
                  isPending ||
                  !acknowledged ||
                  !email.trim() ||
                  !customerTaxIdValid
                }
              >
                {isPending ? t.sending : t.send}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  const signedLine =
    signed && consent
      ? format(t.signed, {
          name: consent.signerName ?? "",
          role: consent.signerRole ? ` (${consent.signerRole})` : "",
          date: day(consent.signedAt),
          ip: consent.signerIp ?? "",
        })
      : null;

  // Step 1's status line when the buyer has not signed (yet).
  let signatureStatus: string = t.notRequested;
  if (consent?.state === "pending") {
    signatureStatus = format(t.pending, {
      email: consent.recipientEmail,
      date: day(consent.expiresAt),
    });
  } else if (consent?.state === "stale") signatureStatus = t.stale;
  else if (consent?.state === "expired") signatureStatus = t.expired;
  else if (consent?.state === "revoked") signatureStatus = t.revoked;

  // The two steps run on a draft with the switch on — except an original
  // whose replacement already holds a number, which is past issuing.
  const showSteps = isDraft && on && !replacedBy?.formattedNumber;
  const canIssue = signed && vatIsZero;

  return (
    <Card
      id="reverse-charge-panel"
      className={on ? "border-indigo-300" : "border-slate-200"}
    >
      <div className="space-y-3 p-4">
        <div className="flex items-center justify-between gap-3">
          <label
            htmlFor="reverse-charge-switch"
            className="flex items-center gap-2 font-semibold"
          >
            <ArrowLeftRight className="h-4 w-4 text-slate-700" />
            {t.title}
          </label>
          <div className="flex items-center gap-2">
            {isPending && <Loader2 className="h-4 w-4 animate-spin text-slate-500" />}
            <span className="text-sm text-muted-foreground">
              {on ? t.switchOn : t.switchOff}
            </span>
            <Switch
              id="reverse-charge-switch"
              checked={on}
              onCheckedChange={toggle}
              disabled={
                !isDraft ||
                !manageable ||
                isPending ||
                (!on && !customerTaxIdValid)
              }
            />
          </div>
        </div>

        {isDraft && <p className="text-sm text-muted-foreground">{t.intro}</p>}
        {isDraft && !on && !customerTaxIdValid && manageable && (
          <p className="rounded-md bg-amber-50 p-2 text-sm text-amber-900">
            {t.needsTaxId}
          </p>
        )}
        {isDraft && afterRefusal && !replacedBy?.formattedNumber && (
          <p className="rounded-md bg-slate-50 p-2 text-sm">{t.afterRefusal}</p>
        )}
        {replaces && (
          <p className="rounded-md bg-slate-50 p-2 text-sm">
            {format(t.replaces, { number: replaces.formattedNumber ?? "" })}{" "}
            <Link className="underline" href={`/outbound/${replaces.id}`}>
              {t.openOriginal}
            </Link>
          </p>
        )}
        {replacedBy && (
          <p className="rounded-md bg-slate-50 p-2 text-sm">
            {replacedBy.formattedNumber
              ? format(t.replacedBy, { number: replacedBy.formattedNumber })
              : t.replacedByDraft}{" "}
            <Link className="underline" href={`/outbound/${replacedBy.id}`}>
              {t.openReplacement}
            </Link>
          </p>
        )}

        {showSteps && (
          <ol className="space-y-4 rounded-md bg-slate-50 p-3 text-sm">
            <Step n={1} title={t.stepSignature} state={signed ? "done" : "current"}>
              {signedLine ? (
                <p>{signedLine}</p>
              ) : (
                <>
                  <p className="flex items-start gap-2">
                    {consent?.state === "pending" && (
                      <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-indigo-600" />
                    )}
                    <span>
                      {signatureStatus}
                      {consent?.state === "pending" && (
                        <span className="block text-xs text-muted-foreground">
                          {t.autoUpdates}
                        </span>
                      )}
                    </span>
                  </p>
                  {manageable && (
                    <Button
                      size="sm"
                      variant={consent?.state === "pending" ? "outline" : "default"}
                      disabled={isPending}
                      onClick={() => setDialogOpen(true)}
                    >
                      {consent ? t.requestAgain : t.request}
                    </Button>
                  )}
                </>
              )}
            </Step>
            <Step n={2} title={t.stepIssue} state={canIssue ? "current" : "locked"}>
              {!vatIsZero ? (
                <>
                  <p className="rounded-md bg-red-50 p-2 text-red-800">
                    {t.appliedVatWarning}
                  </p>
                  {manageable && (
                    <Button size="sm" variant="outline" disabled={isPending} onClick={repairVat}>
                      {t.fixVat}
                    </Button>
                  )}
                </>
              ) : (
                !signed && (
                  <p className="text-muted-foreground">{t.stepIssueLocked}</p>
                )
              )}
              {issue && canManage && (
                <Button
                  size="sm"
                  className="gap-2"
                  disabled={!canIssue || issue.issuing || isPending}
                  onClick={issue.openIssue}
                  data-highlight="doc-issue"
                >
                  {issue.issuing ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <FileSignature className="h-4 w-4" />
                  )}
                  {afterRefusal && !replaces
                    ? t.issueReplacement
                    : format(t.issue, { type: documentTypeLabel })}
                </Button>
              )}
            </Step>
          </ol>
        )}

        {!isDraft && reverseCharge && (
          <>
            <p className="text-sm">{t.issued}</p>
            {signedLine && <p className="text-sm">{signedLine}</p>}
          </>
        )}

        {error && <p className="rounded-md bg-red-50 p-2 text-sm text-red-700">{error}</p>}
      </div>

      {requestDialog}
    </Card>
  );
}
