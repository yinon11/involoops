import { z } from "zod";
import { ENTITY_TYPES, type EntityType } from "@/db/schema/business-entities";

/** Stored in Stripe metadata when the payer uses תעודת זהות rather than ע.מ./ח.פ. */
export const REGISTRATION_KIND_TEUDAT_ZEHUT = "TEUDAT_ZEHUT" as const;

const entityTuple = ENTITY_TYPES as unknown as readonly [
  EntityType,
  ...EntityType[],
];

export const subscriberCheckoutBillingSchema = z
  .object({
    subscriberName: z.string().trim().min(2).max(200),
    businessLegalName: z.string().trim().min(2).max(255),
    registrationScheme: z.enum(["business", "tz"]),
    entityType: z.enum(entityTuple).optional(),
    registrationNumber: z.string().trim().min(5).max(48),
  })
  .superRefine((data, ctx) => {
    const digitsLen = data.registrationNumber.replace(/\D/g, "").length;
    if (digitsLen < 5 || digitsLen > 15) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "registration_digit_length",
        path: ["registrationNumber"],
      });
    }
    if (data.registrationScheme === "business" && !data.entityType) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "entity_type_required",
        path: ["entityType"],
      });
    }
  });

export type SubscriberCheckoutBilling = z.infer<
  typeof subscriberCheckoutBillingSchema
>;
