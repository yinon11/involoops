import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { oauthAdapterPayloads } from "@/db/schema";

type Payload = Record<string, unknown>;

/**
 * oidc-provider storage adapter. One instance per model name
 * (AccessToken, AuthorizationCode, RefreshToken, Grant, Session, …).
 */
export class OauthAdapter {
  constructor(private readonly name: string) {}

  async upsert(id: string, payload: Payload, expiresIn: number) {
    const expiresAt = Number.isFinite(expiresIn)
      ? new Date(Date.now() + expiresIn * 1000)
      : null;
    const row = {
      model: this.name,
      id,
      payload,
      grantId: stringField(payload.grantId),
      userCode: stringField(payload.userCode),
      uid: stringField(payload.uid),
      expiresAt,
      consumedAt: null,
    };
    await db
      .insert(oauthAdapterPayloads)
      .values(row)
      .onConflictDoUpdate({
        target: [oauthAdapterPayloads.model, oauthAdapterPayloads.id],
        set: {
          payload: row.payload,
          grantId: row.grantId,
          userCode: row.userCode,
          uid: row.uid,
          expiresAt: row.expiresAt,
          consumedAt: null,
        },
      });
  }

  async find(id: string): Promise<Payload | undefined> {
    const [row] = await db
      .select()
      .from(oauthAdapterPayloads)
      .where(
        and(
          eq(oauthAdapterPayloads.model, this.name),
          eq(oauthAdapterPayloads.id, id),
        ),
      )
      .limit(1);
    if (!row) return undefined;
    if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) {
      return undefined;
    }
    return row.payload as Payload;
  }

  async findByUserCode(userCode: string): Promise<Payload | undefined> {
    return this.findByColumn("userCode", userCode);
  }

  async findByUid(uid: string): Promise<Payload | undefined> {
    return this.findByColumn("uid", uid);
  }

  async consume(id: string) {
    const payload = await this.find(id);
    if (!payload) return;
    const consumedAt = new Date();
    await db
      .update(oauthAdapterPayloads)
      .set({
        consumedAt,
        payload: {
          ...payload,
          consumed: Math.floor(consumedAt.getTime() / 1000),
        },
      })
      .where(
        and(
          eq(oauthAdapterPayloads.model, this.name),
          eq(oauthAdapterPayloads.id, id),
        ),
      );
  }

  async destroy(id: string) {
    await db
      .delete(oauthAdapterPayloads)
      .where(
        and(
          eq(oauthAdapterPayloads.model, this.name),
          eq(oauthAdapterPayloads.id, id),
        ),
      );
  }

  async revokeByGrantId(grantId: string) {
    await db
      .delete(oauthAdapterPayloads)
      .where(
        and(
          eq(oauthAdapterPayloads.model, this.name),
          eq(oauthAdapterPayloads.grantId, grantId),
        ),
      );
  }

  private async findByColumn(
    column: "userCode" | "uid",
    value: string,
  ): Promise<Payload | undefined> {
    const field =
      column === "uid" ? oauthAdapterPayloads.uid : oauthAdapterPayloads.userCode;
    const [row] = await db
      .select()
      .from(oauthAdapterPayloads)
      .where(
        and(eq(oauthAdapterPayloads.model, this.name), eq(field, value)),
      )
      .limit(1);
    if (!row) return undefined;
    if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) {
      return undefined;
    }
    return row.payload as Payload;
  }
}

function stringField(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
