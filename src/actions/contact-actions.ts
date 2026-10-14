"use server";

import { z } from "zod";
import { headers } from "next/headers";
import { sendContactMessage } from "@/lib/email/transactional";
import { enforceRateLimit } from "@/lib/rate-limit";
import { getDictionary } from "@/lib/i18n/server";

async function getClientIp(): Promise<string> {
  const h = await headers();
  const xff = h.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return h.get("x-real-ip")?.trim() || "unknown";
}

const contactSchema = z.object({
  name: z.string().trim().min(1, "Please enter your name").max(200),
  email: z.string().trim().email("Invalid email address").max(320),
  subject: z.string().trim().max(200).optional(),
  message: z
    .string()
    .trim()
    .min(1, "Please enter a message")
    .max(5000, "Message is too long (max 5000 characters)"),
});

export async function submitContactMessage(formData: FormData) {
  const dict = await getDictionary();
  const raw = {
    name: (formData.get("name") as string) ?? "",
    email: (formData.get("email") as string) ?? "",
    subject: (formData.get("subject") as string) ?? "",
    message: (formData.get("message") as string) ?? "",
  };

  const parsed = contactSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  // Throttle per-IP and per-email so the inbox can't be flooded from one source.
  const ip = await getClientIp();
  const email = parsed.data.email.toLowerCase();
  const ipLimit = await enforceRateLimit(`contact:ip:${ip}`, 10, 60 * 60);
  const emailLimit = await enforceRateLimit(
    `contact:email:${email}`,
    5,
    60 * 60,
  );
  if (!ipLimit.ok || !emailLimit.ok) {
    return {
      error: dict.errors.tooManyMessages,
    };
  }

  const sent = await sendContactMessage({
    name: parsed.data.name,
    email: parsed.data.email,
    subject: parsed.data.subject?.trim() || null,
    message: parsed.data.message,
  });

  if (!sent.ok) {
    return { error: sent.error };
  }

  return {
    success: true,
    message: "Thanks! We got your message and will be in touch shortly.",
  };
}
