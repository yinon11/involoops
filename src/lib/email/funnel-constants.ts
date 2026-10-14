/** Events that trigger funnel entry/exit — adapted for invoice app */
export const FunnelEvents = {
  // Onboarding
  SIGNUP: "SIGNUP",
  // Activation
  FIRST_INVOICE_UPLOADED: "FIRST_INVOICE_UPLOADED",
  TENTH_INVOICE_UPLOADED: "TENTH_INVOICE_UPLOADED",
  // Conversion
  PLAN_LIMIT_APPROACHING: "PLAN_LIMIT_APPROACHING",
  PLAN_LIMIT_REACHED: "PLAN_LIMIT_REACHED",
  // Expansion
  SUBSCRIPTION_STARTED: "SUBSCRIPTION_STARTED",
  SUBSCRIPTION_CANCELLED: "SUBSCRIPTION_CANCELLED",
  // BYOK — user supplies their own Anthropic API key; an alternative path
  // to raising the monthly invoice limit without a paid subscription.
  USER_SET_OWN_KEYS: "USER_SET_OWN_KEYS",
  USER_REMOVED_OWN_KEYS: "USER_REMOVED_OWN_KEYS",
  // Transactional
  PASSWORD_RESET_REQUESTED: "PASSWORD_RESET_REQUESTED",
  // Account-level
  ACCOUNT_DELETED: "ACCOUNT_DELETED",
  UNSUBSCRIBED_ALL: "UNSUBSCRIBED_ALL",
} as const;

export type FunnelEvent = (typeof FunnelEvents)[keyof typeof FunnelEvents];

export const FunnelStatus = {
  ACTIVE: "active",
  COMPLETED: "completed",
  EXITED: "exited",
} as const;

export const FunnelActions = {
  ENTERED: "entered",
  EXITED: "exited",
  COMPLETED: "completed",
  STEP_SENT: "step_sent",
  STEP_SKIPPED: "step_skipped",
  JUMPED: "jumped",
  TIMEOUT: "timeout",
} as const;

export const ExitReasons = {
  ACCOUNT_DELETED: "account_deleted",
  UNSUBSCRIBED_ALL: "unsubscribed_all",
  ALL_STEPS_SENT: "all_steps_sent",
  MUTEX_REPLACED: "mutex_replaced",
  PERMANENT_BOUNCE: "permanent_bounce",
  COMPLAINT: "complaint",
  CONDITION_MET: "condition_met",
} as const;

/** Funnel group display metadata */
export const FUNNEL_GROUPS = [
  { key: "onboarding", label: "Onboarding", color: "#3B82F6", accent: "#DBEAFE" },
  { key: "activation", label: "Activation", color: "#8B5CF6", accent: "#EDE9FE" },
  { key: "conversion", label: "Conversion", color: "#F59E0B", accent: "#FEF3C7" },
  { key: "transactional", label: "Transactional", color: "#6366F1", accent: "#E0E7FF" },
] as const;

/** Safety limits matching Java backend */
export const MAX_EMAILS_PER_USER_PER_DAY = 3;
export const COOLDOWN_HOURS = 4;
export const MAX_STALE_HOURS = 48;
