"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useI18n } from "@/lib/i18n/client";
import type { ShaamEnvironment } from "@/db/schema/shaam-authorizations";

export function ShaamEnvSelector({
  current,
}: {
  current: ShaamEnvironment;
}) {
  const router = useRouter();
  const { dict } = useI18n();
  const [, startTransition] = useTransition();

  function change(next: string) {
    const params = new URLSearchParams();
    params.set("env", next);
    startTransition(() => router.push(`/admin/shaam?${params.toString()}`));
  }

  return (
    <Select value={current} onValueChange={change}>
      <SelectTrigger className="w-40">
        <SelectValue>{dict.shaam.env[current]}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="UAT">{dict.shaam.env.UAT}</SelectItem>
        <SelectItem value="PROD">{dict.shaam.env.PROD}</SelectItem>
      </SelectContent>
    </Select>
  );
}
