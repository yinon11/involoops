import { NextResponse } from "next/server";
import { db } from "@/db";
import { emailLogs, emailClicks } from "@/db/schema/email-logs";
import { userEmailPreferences } from "@/db/schema/user-email-preferences";
import { eq, sql } from "drizzle-orm";
import { onFunnelEvent } from "@/lib/email/funnel-event-service";
import { FunnelEvents } from "@/lib/email/funnel-constants";

interface SnsMessage {
  Type: string;
  SubscribeURL?: string;
  Message: string;
  MessageId: string;
}

interface SesEvent {
  eventType: string;
  mail: {
    messageId: string;
    commonHeaders?: { to?: string[]; subject?: string };
  };
  bounce?: {
    bounceType: string;
    bouncedRecipients: { emailAddress: string }[];
  };
  complaint?: {
    complainedRecipients: { emailAddress: string }[];
  };
  open?: { timestamp: string };
  click?: {
    link: string;
    timestamp: string;
    userAgent?: string;
    ipAddress?: string;
  };
  delivery?: { timestamp: string };
  subscription?: {
    contactList: {
      contactListName: string;
      topicPreferences: {
        topicName: string;
        subscriptionStatus: string;
      }[];
    };
    newTopicPreferences: {
      topicName: string;
      subscriptionStatus: string;
    }[];
  };
}

/**
 * POST /api/webhooks/ses
 * Receives SES event notifications via SNS.
 * Publicly accessible — no auth required.
 */
export async function POST(request: Request) {
  try {
    const body = await request.text();
    const snsMessage: SnsMessage = JSON.parse(body);

    // Handle SNS subscription confirmation
    if (snsMessage.Type === "SubscriptionConfirmation" && snsMessage.SubscribeURL) {
      await fetch(snsMessage.SubscribeURL);
      return NextResponse.json({ ok: true });
    }

    if (snsMessage.Type !== "Notification") {
      return NextResponse.json({ ok: true });
    }

    const sesEvent: SesEvent = JSON.parse(snsMessage.Message);
    const messageId = sesEvent.mail.messageId;

    // Find the email log by SES message ID
    const [log] = await db
      .select()
      .from(emailLogs)
      .where(eq(emailLogs.sesMessageId, messageId))
      .limit(1);

    if (!log) {
      return NextResponse.json({ ok: true, note: "log_not_found" });
    }

    switch (sesEvent.eventType) {
      case "Delivery":
        await db
          .update(emailLogs)
          .set({ status: "delivered", deliveredAt: new Date() })
          .where(eq(emailLogs.id, log.id));
        break;

      case "Bounce":
        await db
          .update(emailLogs)
          .set({
            status: "bounced",
            bouncedAt: new Date(),
            bounceType: sesEvent.bounce?.bounceType ?? null,
          })
          .where(eq(emailLogs.id, log.id));

        // Permanent bounce: exit all funnels (skip if no recipient user, e.g.
        // admin-recipient transactional emails — userId is nullable now).
        if (sesEvent.bounce?.bounceType === "Permanent" && log.userId) {
          try {
            await onFunnelEvent(log.userId, FunnelEvents.UNSUBSCRIBED_ALL);
          } catch {}
        }
        break;

      case "Complaint":
        await db
          .update(emailLogs)
          .set({ status: "complained", complainedAt: new Date() })
          .where(eq(emailLogs.id, log.id));

        // Unsubscribe user and exit all funnels — only when there's a
        // recipient user to unsubscribe.
        if (log.userId) {
          await db
            .insert(userEmailPreferences)
            .values({ userId: log.userId, unsubscribedAll: true })
            .onConflictDoUpdate({
              target: userEmailPreferences.userId,
              set: { unsubscribedAll: true, updatedAt: new Date() },
            });

          try {
            await onFunnelEvent(log.userId, FunnelEvents.UNSUBSCRIBED_ALL);
          } catch {}
        }
        break;

      case "Open":
        await db
          .update(emailLogs)
          .set({
            openedAt: log.openedAt ?? new Date(),
            openCount: sql`${emailLogs.openCount} + 1`,
          })
          .where(eq(emailLogs.id, log.id));
        break;

      case "Click":
        await db
          .update(emailLogs)
          .set({
            clickedAt: log.clickedAt ?? new Date(),
            clickCount: sql`${emailLogs.clickCount} + 1`,
          })
          .where(eq(emailLogs.id, log.id));

        if (sesEvent.click) {
          await db.insert(emailClicks).values({
            emailLogId: log.id,
            url: sesEvent.click.link,
            userAgent: sesEvent.click.userAgent ?? null,
            ipAddress: sesEvent.click.ipAddress ?? null,
          });
        }
        break;

      case "Subscription":
        // User clicked unsubscribe link in email — only meaningful when the
        // log row has a recipient user (admin emails carry no unsubscribe).
        if (sesEvent.subscription && log.userId) {
          const allUnsub = sesEvent.subscription.newTopicPreferences.every(
            (p) => p.subscriptionStatus === "OPT_OUT",
          );
          if (allUnsub) {
            await db
              .insert(userEmailPreferences)
              .values({ userId: log.userId, unsubscribedAll: true })
              .onConflictDoUpdate({
                target: userEmailPreferences.userId,
                set: { unsubscribedAll: true, updatedAt: new Date() },
              });
            try {
              await onFunnelEvent(log.userId, FunnelEvents.UNSUBSCRIBED_ALL);
            } catch {}
          }
        }
        break;
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[SES Webhook] Error:", err);
    // Always return 200 to prevent SNS retries
    return NextResponse.json({ ok: true, error: "processing_error" });
  }
}
