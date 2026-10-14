import Link from "next/link";
import { Clock } from "lucide-react";
import { getDeletionStatus } from "@/actions/gdpr-actions";

/**
 * Persistent warning banner shown at the top of every authenticated page
 * while the user has a pending account-deletion request. Links to the
 * Danger Zone card where they can cancel or review the schedule.
 *
 * Server component — reads the deletion status on every render so a cancel
 * (or a just-submitted request) is reflected without client state juggling.
 */
export async function DeletionBanner() {
  const status = await getDeletionStatus();
  if (!status.requested) return null;

  const date = status.scheduledFor.toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="border-b border-red-200 bg-red-50 text-red-900">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-2 text-sm sm:px-6">
        <Clock className="h-4 w-4 flex-shrink-0" />
        <span className="flex-1">
          Your account is scheduled for deletion on{" "}
          <strong>{date}</strong> ({status.daysRemaining}{" "}
          {status.daysRemaining === 1 ? "day" : "days"} remaining).
        </span>
        <Link
          href="/settings?tab=security"
          className="font-semibold underline underline-offset-2 hover:text-red-700"
        >
          Cancel deletion
        </Link>
      </div>
    </div>
  );
}
