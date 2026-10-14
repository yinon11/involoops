import { relations } from "drizzle-orm";
import { users } from "./users";
import { vendors } from "./vendors";
import { invoices } from "./invoices";
import { accounts, sessions } from "./accounts";
import { periods } from "./periods";
import { extractionRules } from "./extraction-rules";
import { auditLog } from "./audit-log";
import { passwordResetTokens } from "./password-reset-tokens";
import { userEmailFunnelStates } from "./user-email-funnel-states";
import { emailLogs } from "./email-logs";
import { userEmailPreferences } from "./user-email-preferences";
import { userEmailFunnelHistory } from "./user-email-funnel-history";
import { userSubscriptions } from "./user-subscriptions";
import { usageTracking } from "./usage-tracking";
import { customers } from "./customers";
import { invoiceTemplates } from "./invoice-templates";
import { outboundInvoices } from "./outbound-invoices";
import { accountInvitations } from "./account-invitations";

export const usersRelations = relations(users, ({ many, one }) => ({
  vendors: many(vendors),
  invoices: many(invoices),
  accounts: many(accounts),
  sessions: many(sessions),
  periods: many(periods),
  extractionRules: many(extractionRules),
  auditLogs: many(auditLog),
  passwordResetTokens: many(passwordResetTokens),
  emailFunnelStates: many(userEmailFunnelStates),
  emailLogs: many(emailLogs),
  emailPreferences: one(userEmailPreferences),
  emailFunnelHistory: many(userEmailFunnelHistory),
  subscription: one(userSubscriptions),
  usageTracking: many(usageTracking),
  customers: many(customers),
  invoiceTemplates: many(invoiceTemplates),
  outboundInvoices: many(outboundInvoices),
  accountInvitations: many(accountInvitations),
}));
