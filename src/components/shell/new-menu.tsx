"use client";

import Link from "next/link";
import { Plus, Send, Upload } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * The single create action for the whole app.
 *
 * Issuing a document and uploading an expense used to be two primary buttons
 * living in two different sidebars, which is a large part of why the two
 * products felt bolted together. Creating is a verb, not a place: one button,
 * two destinations.
 */
export function NewMenu({
  labels,
  compact = false,
}: {
  labels: { new: string; issueDocument: string; uploadExpense: string };
  compact?: boolean;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={`flex items-center justify-center gap-2 rounded-lg bg-primary font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus:outline-none ${
          compact ? "h-9 w-9" : "h-10 w-full px-4 text-sm"
        }`}
        aria-label={labels.new}
        data-highlight="nav-new"
        data-voice-action="nav-new"
      >
        <Plus className="h-4 w-4 shrink-0" />
        {compact ? null : <span className="truncate">{labels.new}</span>}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[220px]">
        <DropdownMenuItem asChild className="cursor-pointer gap-2">
          <Link href="/outbound/new" data-highlight="nav-new-document" data-voice-action="nav-new-document">
            <Send className="h-4 w-4 shrink-0" />
            <span className="truncate">{labels.issueDocument}</span>
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild className="cursor-pointer gap-2">
          <Link href="/invoices/upload" data-highlight="nav-new-upload" data-voice-action="nav-new-upload">
            <Upload className="h-4 w-4 shrink-0" />
            <span className="truncate">{labels.uploadExpense}</span>
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
