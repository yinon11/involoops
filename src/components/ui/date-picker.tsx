"use client";

import { useState } from "react";
import { CalendarIcon } from "lucide-react";
import { parseISO, isValid } from "date-fns";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/client";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

interface DatePickerProps {
  value: string; // YYYY-MM-DD
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  id?: string;
}

function parseDate(value: string): Date | null {
  if (!value) return null;
  const d = parseISO(value);
  return isValid(d) ? d : null;
}

export function DatePicker({
  value,
  onChange,
  placeholder,
  className,
  id,
}: DatePickerProps) {
  const { dict, tag } = useI18n();
  const [open, setOpen] = useState(false);
  const date = parseDate(value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          variant="outline"
          className={cn(
            "w-full justify-start gap-2 font-normal",
            !date && "text-muted-foreground",
            className,
          )}
        >
          <CalendarIcon className="h-4 w-4 shrink-0" />
          {date
            ? date.toLocaleDateString(tag, {
                year: "numeric",
                month: "long",
                day: "numeric",
              })
            : (placeholder ?? dict.common.pickADate)}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-3" align="start">
        <input
          type="date"
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            if (e.target.value) setOpen(false);
          }}
          className="rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </PopoverContent>
    </Popover>
  );
}
