"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { format } from "@/lib/i18n/format";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import { signReverseChargeConsentAction } from "@/actions/reverse-charge-consent-sign-actions";

// Fixed backing size: the stored PNG is the same whatever the screen, and
// small enough (a few KB of strokes) to stay far under the server's cap.
const CANVAS_W = 600;
const CANVAS_H = 200;

interface Props {
  token: string;
  locale: "he" | "en";
  buyerName: string;
  /** Who keeps the signed record — named in the privacy notice. */
  sellerName: string;
  /** Passed in rather than read from context: the page's language comes from the link. */
  t: Dictionary["consentPage"];
}

export function SignatureForm({ token, locale, buyerName, sellerName, t }: Props) {
  const router = useRouter();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [hasInk, setHasInk] = useState(false);
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function point(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * CANVAS_W,
      y: ((e.clientY - rect.top) / rect.height) * CANVAS_H,
    };
  }

  function onDown(e: React.PointerEvent<HTMLCanvasElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    last.current = point(e);
  }

  function onMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current || !last.current) return;
    const ctx = e.currentTarget.getContext("2d");
    if (!ctx) return;
    const p = point(e);
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#111827";
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = p;
    if (!hasInk) setHasInk(true);
  }

  function onUp() {
    drawing.current = false;
    last.current = null;
  }

  function clear() {
    const canvas = canvasRef.current;
    canvas?.getContext("2d")?.clearRect(0, 0, CANVAS_W, CANVAS_H);
    setHasInk(false);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (name.trim().length < 2) return setError(t.needName);
    if (!hasInk || !canvasRef.current) return setError(t.needSignature);
    if (!agreed) return setError(t.needAgree);

    const signaturePng = canvasRef.current.toDataURL("image/png");
    startTransition(async () => {
      const res = await signReverseChargeConsentAction({
        token,
        signerName: name,
        signerRole: role || null,
        signaturePng,
        locale,
      });
      if (res.ok || res.state) {
        // Signed — or no longer signable (expired, replaced, edited): either
        // way the server page now says what happened, in the buyer's language.
        router.refresh();
        return;
      }
      setError(res.rateLimited ? t.tooManyRequests : res.error);
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4 border-t pt-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="rc-name">{t.fullName}</Label>
          <Input
            id="rc-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={200}
            autoComplete="name"
            required
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="rc-role">{t.role}</Label>
          <Input
            id="rc-role"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            maxLength={200}
            placeholder={t.rolePlaceholder}
            autoComplete="organization-title"
          />
        </div>
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <Label>{t.signatureLabel}</Label>
          <button
            type="button"
            onClick={clear}
            className="text-sm text-indigo-600 underline"
          >
            {t.clear}
          </button>
        </div>
        <canvas
          ref={canvasRef}
          width={CANVAS_W}
          height={CANVAS_H}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          aria-label={t.signatureLabel}
          className="h-40 w-full touch-none rounded-md border border-dashed border-gray-400 bg-white"
        />
      </div>

      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={agreed}
          onChange={(e) => setAgreed(e.target.checked)}
          className="mt-0.5 h-4 w-4"
        />
        <span>{format(t.agree, { buyer: buyerName })}</span>
      </label>

      <p className="text-xs text-gray-500">
        {t.recordNotice} {format(t.recordKeeper, { seller: sellerName })}{" "}
        <a
          href={`/${locale}/privacy`}
          target="_blank"
          rel="noopener noreferrer"
          className="underline"
        >
          {t.privacyLink}
        </a>
      </p>

      {error && (
        <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>
      )}

      <Button type="submit" disabled={isPending} className="w-full sm:w-auto">
        {isPending ? t.submitting : t.submit}
      </Button>
    </form>
  );
}
