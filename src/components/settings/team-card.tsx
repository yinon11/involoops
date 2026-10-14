"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Users, Trash2, RefreshCw, Send } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import {
  CAPABILITIES,
  type Capability,
} from "@/lib/team/capabilities";
import {
  createTeamInvitation,
  removeTeamMember,
  resendTeamInvitation,
  revokeTeamInvitation,
  updateTeamMemberCapabilities,
  updateTeamMemberAutoActAs,
} from "@/actions/team-invitation-actions";

export interface TeamMemberRow {
  linkId: string;
  memberUserId: string;
  memberEmail: string;
  memberName: string | null;
  capabilities: string[];
  autoActAs: boolean;
}

export interface TeamInvitationRow {
  id: string;
  email: string;
  capabilities: string[];
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

interface TeamCardProps {
  members: TeamMemberRow[];
  invitations: TeamInvitationRow[];
}

const DEFAULT_CAPS: Capability[] = ["view_invoices", "view_vendors"];

export function TeamCard({ members, invitations }: TeamCardProps) {
  const { dict } = useI18n();
  const t = dict.settings.team;
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  const [email, setEmail] = useState("");
  const [selectedCaps, setSelectedCaps] = useState<Capability[]>(DEFAULT_CAPS);

  function toggleCap(code: Capability) {
    setSelectedCaps((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code],
    );
  }

  async function handleInvite(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFeedback(null);
    const fd = new FormData();
    fd.set("email", email);
    for (const c of selectedCaps) fd.append("capabilities", c);
    const result = await createTeamInvitation(fd);
    if (!result.ok) {
      setFeedback({ type: "error", message: result.error });
      return;
    }
    setFeedback({ type: "success", message: t.feedback.invited });
    setEmail("");
    setSelectedCaps(DEFAULT_CAPS);
    startTransition(() => router.refresh());
  }

  async function handleResend(id: string) {
    setFeedback(null);
    const result = await resendTeamInvitation(id);
    if (!result.ok) {
      setFeedback({ type: "error", message: result.error });
      return;
    }
    setFeedback({ type: "success", message: t.feedback.resent });
    startTransition(() => router.refresh());
  }

  async function handleRevoke(id: string) {
    setFeedback(null);
    const result = await revokeTeamInvitation(id);
    if (!result.ok) {
      setFeedback({ type: "error", message: result.error });
      return;
    }
    setFeedback({ type: "success", message: t.feedback.revoked });
    startTransition(() => router.refresh());
  }

  async function handleRemove(linkId: string) {
    setFeedback(null);
    const result = await removeTeamMember(linkId);
    if (!result.ok) {
      setFeedback({ type: "error", message: result.error });
      return;
    }
    setFeedback({ type: "success", message: t.feedback.removed });
    startTransition(() => router.refresh());
  }

  async function handleUpdate(linkId: string, caps: Capability[]) {
    setFeedback(null);
    const result = await updateTeamMemberCapabilities(linkId, caps);
    if (!result.ok) {
      setFeedback({ type: "error", message: result.error });
      return;
    }
    setFeedback({ type: "success", message: t.feedback.updated });
    startTransition(() => router.refresh());
  }

  async function handleAutoActAs(linkId: string, enabled: boolean) {
    setFeedback(null);
    const result = await updateTeamMemberAutoActAs(linkId, enabled);
    if (!result.ok) {
      setFeedback({ type: "error", message: result.error });
      return;
    }
    setFeedback({
      type: "success",
      message: enabled ? t.feedback.autoActAsOn : t.feedback.autoActAsOff,
    });
    startTransition(() => router.refresh());
  }

  const pendingInvitations = invitations.filter(
    (inv) => !inv.acceptedAt && !inv.revokedAt,
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="h-5 w-5" />
          {t.title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <p className="text-sm text-muted-foreground">{t.description}</p>

        {feedback && (
          <div
            className={`rounded-md p-3 text-sm ${
              feedback.type === "success"
                ? "bg-green-50 text-green-700"
                : "bg-red-50 text-red-700"
            }`}
          >
            {feedback.message}
          </div>
        )}

        <form onSubmit={handleInvite} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="invite-email">{t.form.emailLabel}</Label>
            <Input
              id="invite-email"
              type="email"
              required
              placeholder={t.form.emailPlaceholder}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={isPending}
            />
          </div>

          <div>
            <Label className="mb-2 block">{t.form.capabilitiesLabel}</Label>
            <div className="grid gap-2 sm:grid-cols-2">
              {CAPABILITIES.map((cap) => (
                <label
                  key={cap}
                  className="flex items-center gap-2 text-sm"
                >
                  <Checkbox
                    checked={selectedCaps.includes(cap)}
                    onCheckedChange={() => toggleCap(cap)}
                    disabled={isPending}
                  />
                  {t.capabilities[cap]}
                </label>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {t.form.capabilitiesHint}
            </p>
          </div>

          <Button type="submit" disabled={isPending || !email.trim()}>
            {t.form.submit}
          </Button>
        </form>

        <Separator />

        <div>
          <h3 className="mb-3 font-semibold text-sm">{t.pending.title}</h3>
          {pendingInvitations.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t.pending.empty}</p>
          ) : (
            <ul className="space-y-2">
              {pendingInvitations.map((inv) => (
                <li
                  key={inv.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3"
                >
                  <div className="text-sm">
                    <div className="font-medium">{inv.email}</div>
                    <div className="text-xs text-muted-foreground">
                      {t.pending.expires.replace(
                        "{date}",
                        new Date(inv.expiresAt).toLocaleDateString(),
                      )}
                      {" · "}
                      {inv.capabilities.length} {t.pending.permissions}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => handleResend(inv.id)}
                      disabled={isPending}
                    >
                      <Send className="mr-1 h-3 w-3" /> {t.pending.resend}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => handleRevoke(inv.id)}
                      disabled={isPending}
                    >
                      <RefreshCw className="mr-1 h-3 w-3" /> {t.pending.revoke}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <Separator />

        <div>
          <h3 className="mb-3 font-semibold text-sm">{t.members.title}</h3>
          {members.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t.members.empty}</p>
          ) : (
            <ul className="space-y-3">
              {members.map((m) => (
                <MemberRow
                  key={m.linkId}
                  member={m}
                  disabled={isPending}
                  capabilityLabels={t.capabilities}
                  saveLabel={t.members.save}
                  removeLabel={t.members.remove}
                  autoActAsLabel={t.members.autoActAsLabel}
                  autoActAsHint={t.members.autoActAsHint}
                  onUpdate={handleUpdate}
                  onRemove={handleRemove}
                  onAutoActAsChange={handleAutoActAs}
                />
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

interface MemberRowProps {
  member: TeamMemberRow;
  disabled: boolean;
  capabilityLabels: Record<Capability, string>;
  saveLabel: string;
  removeLabel: string;
  autoActAsLabel: string;
  autoActAsHint: string;
  onUpdate: (linkId: string, caps: Capability[]) => Promise<void>;
  onRemove: (linkId: string) => Promise<void>;
  onAutoActAsChange: (linkId: string, enabled: boolean) => Promise<void>;
}

function MemberRow({
  member,
  disabled,
  capabilityLabels,
  saveLabel,
  removeLabel,
  autoActAsLabel,
  autoActAsHint,
  onUpdate,
  onRemove,
  onAutoActAsChange,
}: MemberRowProps) {
  const [caps, setCaps] = useState<Capability[]>(
    member.capabilities.filter((c): c is Capability =>
      (CAPABILITIES as readonly string[]).includes(c),
    ),
  );
  const [dirty, setDirty] = useState(false);
  // Optimistic local state so the switch reflects the click immediately;
  // server confirms on the action result via router.refresh in the parent.
  const [autoActAs, setAutoActAs] = useState(member.autoActAs);

  function toggle(code: Capability) {
    setDirty(true);
    setCaps((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code],
    );
  }

  async function handleAutoActAs(next: boolean) {
    const previous = autoActAs;
    setAutoActAs(next);
    try {
      await onAutoActAsChange(member.linkId, next);
    } catch {
      setAutoActAs(previous);
    }
  }

  return (
    <li className="rounded-md border p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm">
          <div className="font-medium">
            {member.memberName || member.memberEmail}
          </div>
          {member.memberName && (
            <div className="text-xs text-muted-foreground">
              {member.memberEmail}
            </div>
          )}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onRemove(member.linkId)}
          disabled={disabled}
        >
          <Trash2 className="mr-1 h-3 w-3" /> {removeLabel}
        </Button>
      </div>
      <div className="mb-3 flex items-start justify-between gap-3 rounded-md bg-muted/40 p-2.5">
        <div className="min-w-0">
          <div className="text-sm font-medium">{autoActAsLabel}</div>
          <div className="text-xs text-muted-foreground">{autoActAsHint}</div>
        </div>
        <Switch
          checked={autoActAs}
          onCheckedChange={handleAutoActAs}
          disabled={disabled}
          aria-label={autoActAsLabel}
        />
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {CAPABILITIES.map((cap) => (
          <label key={cap} className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={caps.includes(cap)}
              onCheckedChange={() => toggle(cap)}
              disabled={disabled}
            />
            {capabilityLabels[cap]}
          </label>
        ))}
      </div>
      {dirty && (
        <div className="mt-3">
          <Button
            type="button"
            size="sm"
            onClick={async () => {
              await onUpdate(member.linkId, caps);
              setDirty(false);
            }}
            disabled={disabled}
          >
            {saveLabel}
          </Button>
        </div>
      )}
    </li>
  );
}
