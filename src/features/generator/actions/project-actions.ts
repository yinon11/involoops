"use server";

import { db } from "@/db";
import {
  customers,
  outboundInvoices,
  projectMilestones,
  projects,
} from "@/db/schema";
import { and, asc, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireActorUserId as requireUserId } from "@/lib/team/enforce";

// ─── Return types ─────────────────────────────────────────────────────────────

export interface ProjectListItem {
  id: string;
  name: string;
  totalAmount: string;
  currency: string;
  status: "active" | "completed" | "cancelled";
  startDate: string | null;
  notes: string | null;
  createdAt: Date | null;
  customerId: string | null;
  customerName: string | null;
  collected: number;
  outstanding: number;
  totalMilestones: number;
  nextDueDate: string | null;
}

export interface MilestoneWithInvoice {
  id: string;
  projectId: string;
  title: string;
  amount: string;
  dueDate: string;
  status: "pending" | "invoiced" | "paid";
  outboundInvoiceId: string | null;
  invoiceNumber: string | null;
  notes: string | null;
  createdAt: Date | null;
}

export interface ProjectDetail {
  id: string;
  userId: string;
  name: string;
  totalAmount: string;
  currency: string;
  status: "active" | "completed" | "cancelled";
  startDate: string | null;
  notes: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
  customerId: string | null;
  customerName: string | null;
  milestones: MilestoneWithInvoice[];
}

// ─── getProjects ──────────────────────────────────────────────────────────────

/**
 * List all non-cancelled projects for the current user, enriched with:
 *   - customer name
 *   - milestone aggregate: collected, outstanding, total count, next due date
 *
 * Uses two queries to avoid a multi-column GROUP BY over the full projects row.
 */
export async function getProjects(): Promise<ProjectListItem[]> {
  const userId = await requireUserId("view_outbound");

  const projectRows = await db
    .select({
      id: projects.id,
      name: projects.name,
      totalAmount: projects.totalAmount,
      currency: projects.currency,
      status: projects.status,
      startDate: projects.startDate,
      notes: projects.notes,
      createdAt: projects.createdAt,
      customerId: projects.customerId,
      customerName: customers.name,
    })
    .from(projects)
    .leftJoin(customers, eq(projects.customerId, customers.id))
    .where(
      and(
        eq(projects.userId, userId),
        ne(projects.status, "cancelled"),
      ),
    )
    .orderBy(desc(projects.createdAt));

  if (projectRows.length === 0) return [];

  const ids = projectRows.map((p) => p.id);
  const milestoneAggs = await db
    .select({
      projectId: projectMilestones.projectId,
      collected: sql<number>`coalesce(sum(case when ${projectMilestones.status} = 'paid' then ${projectMilestones.amount}::numeric else 0 end), 0)::float`,
      outstanding: sql<number>`coalesce(sum(case when ${projectMilestones.status} in ('pending','invoiced') then ${projectMilestones.amount}::numeric else 0 end), 0)::float`,
      totalMilestones: sql<number>`count(*)::int`,
      nextDueDate: sql<string | null>`min(case when ${projectMilestones.status} = 'pending' then ${projectMilestones.dueDate}::text end)`,
    })
    .from(projectMilestones)
    .where(inArray(projectMilestones.projectId, ids))
    .groupBy(projectMilestones.projectId);

  const aggMap = new Map(milestoneAggs.map((a) => [a.projectId, a]));

  return projectRows.map((p) => {
    const agg = aggMap.get(p.id);
    return {
      ...p,
      status: p.status as ProjectListItem["status"],
      collected: agg?.collected ?? 0,
      outstanding: agg?.outstanding ?? 0,
      totalMilestones: agg?.totalMilestones ?? 0,
      nextDueDate: agg?.nextDueDate ?? null,
    };
  });
}

// ─── getProject ───────────────────────────────────────────────────────────────

/**
 * Single project with all milestones sorted by due_date.
 * Returns null if not found or not owned by the current user.
 */
export async function getProject(
  projectId: string,
): Promise<ProjectDetail | null> {
  const userId = await requireUserId("view_outbound");

  const [project] = await db
    .select({
      id: projects.id,
      userId: projects.userId,
      name: projects.name,
      totalAmount: projects.totalAmount,
      currency: projects.currency,
      status: projects.status,
      startDate: projects.startDate,
      notes: projects.notes,
      createdAt: projects.createdAt,
      updatedAt: projects.updatedAt,
      customerId: projects.customerId,
      customerName: customers.name,
    })
    .from(projects)
    .leftJoin(customers, eq(projects.customerId, customers.id))
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)));

  if (!project) return null;

  const milestoneRows = await db
    .select({
      id: projectMilestones.id,
      projectId: projectMilestones.projectId,
      title: projectMilestones.title,
      amount: projectMilestones.amount,
      dueDate: projectMilestones.dueDate,
      status: projectMilestones.status,
      outboundInvoiceId: projectMilestones.outboundInvoiceId,
      invoiceNumber: outboundInvoices.formattedNumber,
      notes: projectMilestones.notes,
      createdAt: projectMilestones.createdAt,
    })
    .from(projectMilestones)
    .leftJoin(
      outboundInvoices,
      eq(projectMilestones.outboundInvoiceId, outboundInvoices.id),
    )
    .where(eq(projectMilestones.projectId, projectId))
    .orderBy(asc(projectMilestones.dueDate));

  return {
    ...project,
    status: project.status as ProjectDetail["status"],
    milestones: milestoneRows.map((m) => ({
      ...m,
      status: m.status as MilestoneWithInvoice["status"],
    })),
  };
}

// ─── createProject ────────────────────────────────────────────────────────────

export interface CreateProjectPayload {
  name: string;
  customerId?: string;
  totalAmount: number;
  currency: string;
  startDate?: string;
  notes?: string;
  milestones: Array<{
    title: string;
    amount: number;
    dueDate: string;
    notes?: string;
  }>;
}

export async function createProject(payload: CreateProjectPayload) {
  const userId = await requireUserId("manage_outbound");

  const milestoneSum = payload.milestones.reduce((s, m) => s + m.amount, 0);
  if (milestoneSum > payload.totalAmount + 0.01) {
    throw new Error(
      `Milestone total (${milestoneSum}) exceeds project total (${payload.totalAmount}).`,
    );
  }

  const project = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(projects)
      .values({
        userId,
        customerId: payload.customerId ?? null,
        name: payload.name,
        totalAmount: String(payload.totalAmount),
        currency: payload.currency,
        startDate: payload.startDate ?? null,
        notes: payload.notes ?? null,
      })
      .returning();

    if (payload.milestones.length > 0) {
      await tx.insert(projectMilestones).values(
        payload.milestones.map((m) => ({
          projectId: row.id,
          title: m.title,
          amount: String(m.amount),
          dueDate: m.dueDate,
          notes: m.notes ?? null,
        })),
      );
    }

    return row;
  });

  revalidatePath("/outbound/projects");
  return project;
}

// ─── updateProject ────────────────────────────────────────────────────────────

export interface UpdateProjectPayload {
  name?: string;
  customerId?: string | null;
  totalAmount?: number;
  currency?: string;
  startDate?: string | null;
  notes?: string | null;
  status?: "active" | "completed" | "cancelled";
}

export async function updateProject(
  projectId: string,
  payload: UpdateProjectPayload,
) {
  const userId = await requireUserId("manage_outbound");

  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (payload.name !== undefined) set.name = payload.name;
  if (payload.customerId !== undefined) set.customerId = payload.customerId;
  if (payload.totalAmount !== undefined)
    set.totalAmount = String(payload.totalAmount);
  if (payload.currency !== undefined) set.currency = payload.currency;
  if (payload.startDate !== undefined) set.startDate = payload.startDate;
  if (payload.notes !== undefined) set.notes = payload.notes;
  if (payload.status !== undefined) set.status = payload.status;

  const [row] = await db
    .update(projects)
    .set(set)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
    .returning();

  revalidatePath(`/outbound/projects/${projectId}`);
  revalidatePath("/outbound/projects");
  return row;
}

// ─── addMilestone ─────────────────────────────────────────────────────────────

export interface AddMilestonePayload {
  title: string;
  amount: number;
  dueDate: string;
  notes?: string;
}

export async function addMilestone(
  projectId: string,
  payload: AddMilestonePayload,
) {
  const userId = await requireUserId("manage_outbound");

  // Verify project ownership
  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)));
  if (!project) throw new Error("Project not found");

  const [row] = await db
    .insert(projectMilestones)
    .values({
      projectId,
      title: payload.title,
      amount: String(payload.amount),
      dueDate: payload.dueDate,
      notes: payload.notes ?? null,
    })
    .returning();

  revalidatePath(`/outbound/projects/${projectId}`);
  return row;
}

// ─── updateMilestone ──────────────────────────────────────────────────────────

export interface UpdateMilestonePayload {
  title?: string;
  amount?: number;
  dueDate?: string;
  status?: "pending" | "invoiced" | "paid";
  notes?: string | null;
}

export async function updateMilestone(
  milestoneId: string,
  payload: UpdateMilestonePayload,
) {
  const userId = await requireUserId("manage_outbound");

  // Verify ownership via project join
  const [existing] = await db
    .select({ projectId: projectMilestones.projectId })
    .from(projectMilestones)
    .innerJoin(projects, eq(projectMilestones.projectId, projects.id))
    .where(
      and(
        eq(projectMilestones.id, milestoneId),
        eq(projects.userId, userId),
      ),
    );
  if (!existing) throw new Error("Milestone not found");

  const set: Record<string, unknown> = {};
  if (payload.title !== undefined) set.title = payload.title;
  if (payload.amount !== undefined) set.amount = String(payload.amount);
  if (payload.dueDate !== undefined) set.dueDate = payload.dueDate;
  if (payload.status !== undefined) set.status = payload.status;
  if (payload.notes !== undefined) set.notes = payload.notes;

  const [row] = await db
    .update(projectMilestones)
    .set(set)
    .where(eq(projectMilestones.id, milestoneId))
    .returning();

  revalidatePath(`/outbound/projects/${existing.projectId}`);
  return row;
}

// ─── linkMilestoneToInvoice ───────────────────────────────────────────────────

/**
 * Associate a milestone with an issued outbound invoice and advance its
 * status to 'invoiced'. Called after the user issues an invoice from the
 * new-invoice flow's redirect back (or manually from the project detail).
 */
export async function linkMilestoneToInvoice(
  milestoneId: string,
  invoiceId: string,
) {
  const userId = await requireUserId("manage_outbound");

  const [existing] = await db
    .select({ projectId: projectMilestones.projectId })
    .from(projectMilestones)
    .innerJoin(projects, eq(projectMilestones.projectId, projects.id))
    .where(
      and(
        eq(projectMilestones.id, milestoneId),
        eq(projects.userId, userId),
      ),
    );
  if (!existing) throw new Error("Milestone not found");

  const [row] = await db
    .update(projectMilestones)
    .set({ outboundInvoiceId: invoiceId, status: "invoiced" })
    .where(eq(projectMilestones.id, milestoneId))
    .returning();

  revalidatePath(`/outbound/projects/${existing.projectId}`);
  return row;
}

// ─── deleteMilestone ──────────────────────────────────────────────────────────

/** Deletes a milestone only if it is still pending and has no linked invoice. */
export async function deleteMilestone(milestoneId: string) {
  const userId = await requireUserId("manage_outbound");

  const [existing] = await db
    .select({
      projectId: projectMilestones.projectId,
      status: projectMilestones.status,
      outboundInvoiceId: projectMilestones.outboundInvoiceId,
    })
    .from(projectMilestones)
    .innerJoin(projects, eq(projectMilestones.projectId, projects.id))
    .where(
      and(
        eq(projectMilestones.id, milestoneId),
        eq(projects.userId, userId),
      ),
    );

  if (!existing) throw new Error("Milestone not found");
  if (existing.status !== "pending" || existing.outboundInvoiceId !== null) {
    throw new Error(
      "Only pending milestones with no linked invoice can be deleted.",
    );
  }

  await db
    .delete(projectMilestones)
    .where(eq(projectMilestones.id, milestoneId));

  revalidatePath(`/outbound/projects/${existing.projectId}`);
}

// ─── deleteProject (soft) ─────────────────────────────────────────────────────

/** Soft-deletes a project by setting its status to 'cancelled'. */
export async function deleteProject(projectId: string) {
  const userId = await requireUserId("manage_outbound");

  await db
    .update(projects)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)));

  revalidatePath("/outbound/projects");
}
