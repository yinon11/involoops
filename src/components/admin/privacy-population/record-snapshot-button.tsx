"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { recordPopulationSnapshot } from "@/actions/privacy-population-actions";

export function RecordSnapshotButton() {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Note (optional)"
        maxLength={500}
        className="w-56"
      />
      <Button
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const res = await recordPopulationSnapshot(note);
            if (!res.ok) {
              toast.error(res.error);
              return;
            }
            toast.success(`Snapshot recorded: ${res.total.toLocaleString("en-US")} people`);
            setNote("");
            router.refresh();
          })
        }
      >
        {pending ? "Recording…" : "Record snapshot"}
      </Button>
    </div>
  );
}
