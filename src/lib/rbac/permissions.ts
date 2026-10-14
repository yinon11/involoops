/**
 * RBAC permissions for outbound invoicing (Spec 03).
 *
 * The permission strings are the wire format that lives inside a
 * `business_entity_members.permissions` JSON array. Role presets below
 * are seeds only; the stored JSON is authoritative at runtime.
 */

import type { BusinessRole } from "@/db/schema/business-entity-members";

export const PERMISSIONS = {
  DOCUMENT_CREATE_DRAFT: "document:create_draft",
  DOCUMENT_ISSUE: "document:issue",
  DOCUMENT_VOID: "document:void",
  DOCUMENT_VIEW: "document:view",
  AUDIT_VIEW: "audit:view",
  AUDIT_EXPORT: "audit:export",
  EXPORT_UNIFORM_STRUCTURE: "export:uniform_structure",
  BUSINESS_ENTITY_EDIT: "business_entity:edit",
  MEMBERS_MANAGE: "members:manage",
  /** Spec 09 — manage the SHAAM onboarding flow (start/renew/disconnect). */
  ITA_INTEGRATION_MANAGE: "ita_integration:manage",
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ALL_PERMISSIONS: Permission[] = Object.values(PERMISSIONS);

export const ROLE_PRESETS: Record<BusinessRole, Permission[]> = {
  OWNER: ALL_PERMISSIONS,
  ACCOUNTANT: [
    PERMISSIONS.DOCUMENT_CREATE_DRAFT,
    PERMISSIONS.DOCUMENT_ISSUE,
    PERMISSIONS.DOCUMENT_VOID,
    PERMISSIONS.DOCUMENT_VIEW,
    PERMISSIONS.AUDIT_VIEW,
    PERMISSIONS.AUDIT_EXPORT,
    PERMISSIONS.EXPORT_UNIFORM_STRUCTURE,
    PERMISSIONS.ITA_INTEGRATION_MANAGE,
  ],
  ISSUER: [
    PERMISSIONS.DOCUMENT_CREATE_DRAFT,
    PERMISSIONS.DOCUMENT_ISSUE,
    PERMISSIONS.DOCUMENT_VIEW,
  ],
  VIEWER: [PERMISSIONS.DOCUMENT_VIEW],
  AUDITOR: [
    PERMISSIONS.DOCUMENT_VIEW,
    PERMISSIONS.AUDIT_VIEW,
    PERMISSIONS.AUDIT_EXPORT,
    PERMISSIONS.EXPORT_UNIFORM_STRUCTURE,
  ],
};

export function isPermission(value: unknown): value is Permission {
  return (
    typeof value === "string" &&
    (ALL_PERMISSIONS as string[]).includes(value)
  );
}
