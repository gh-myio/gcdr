import { eq, and, inArray } from 'drizzle-orm';
import { db, schema } from '../infrastructure/database/drizzle/db';
import { Central, ConnectionStatus, createDefaultCentralConfig, createDefaultCentralStats } from '../domain/entities/Central';
import { CreateCentralDTO, UpdateCentralDTO, ListCentralsDTO } from '../dto/request/CentralDTO';
import { PaginatedResult, EntityStatus } from '../shared/types';
import { ICentralRepository } from './interfaces/ICentralRepository';
import { generateId } from '../shared/utils/idGenerator';
import { now } from '../shared/utils/dateUtils';
import { AppError } from '../shared/errors/AppError';
import { countWhere } from './helpers/countQuery';

const { centrals } = schema;

/** The Drizzle transaction client passed to `db.transaction(async (tx) => …)`. */
export type CentralTx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type CentralDbClient = typeof db | CentralTx;

export class CentralRepository implements ICentralRepository {

  /**
   * RFC-0056 (P1 fix) — run a callback inside a Postgres transaction on the
   * `centrals` table, e.g. `lockByIdQuery` + `patchConfig` to make a
   * read-check-mint-write sequence atomic (mirrors
   * CentralReplacementRepository.replace()'s transaction shape).
   */
  async withTransaction<T>(fn: (tx: CentralTx) => Promise<T>): Promise<T> {
    return db.transaction(fn);
  }

  /**
   * RFC-0056 (P1 fix) — lock the central row for the duration of the caller's
   * transaction (mirrors CentralReplacementRepository.lockOldCentralQuery).
   * Must be awaited inside a `withTransaction` callback with `client` set to
   * the `tx` it received; otherwise the lock is released immediately.
   */
  lockByIdQuery(tenantId: string, id: string, client: CentralDbClient = db) {
    return client
      .select()
      .from(centrals)
      .where(and(eq(centrals.tenantId, tenantId), eq(centrals.id, id)))
      .limit(1)
      .for('update');
  }

  async create(tenantId: string, data: CreateCentralDTO, createdBy: string): Promise<Central> {
    const id = data.id || generateId();
    const timestamp = now();

    const [result] = await db.insert(centrals).values({
      id,
      tenantId,
      customerId: data.customerId,
      assetId: data.assetId,
      name: data.name,
      displayName: data.displayName,
      serialNumber: data.serialNumber,
      type: data.type,
      status: 'ACTIVE',
      connectionStatus: 'OFFLINE',
      firmwareVersion: data.firmwareVersion || '0.0.0',
      softwareVersion: data.softwareVersion || '0.0.0',
      frequency: data.frequency ?? 60,
      config: data.config ? { ...createDefaultCentralConfig(), ...data.config } : createDefaultCentralConfig(),
      stats: createDefaultCentralStats(),
      location: data.location || null,
      tags: data.tags || [],
      metadata: data.metadata || {},
      version: 1,
      createdAt: new Date(timestamp),
      updatedAt: new Date(timestamp),
      createdBy,
    }).returning();

    return this.mapToEntity(result);
  }

  async getById(tenantId: string, id: string): Promise<Central | null> {
    const [result] = await db
      .select()
      .from(centrals)
      .where(and(eq(centrals.tenantId, tenantId), eq(centrals.id, id)))
      .limit(1);

    return result ? this.mapToEntity(result) : null;
  }

  /** RFC-0055 — batch lookup for the enrichment endpoint. */
  async findByIds(tenantId: string, ids: string[]): Promise<Central[]> {
    if (ids.length === 0) return [];
    const rows = await db
      .select()
      .from(centrals)
      .where(and(eq(centrals.tenantId, tenantId), inArray(centrals.id, ids)));
    return rows.map((r) => this.mapToEntity(r));
  }

  async getBySerialNumber(tenantId: string, serialNumber: string): Promise<Central | null> {
    const [result] = await db
      .select()
      .from(centrals)
      .where(and(
        eq(centrals.tenantId, tenantId),
        eq(centrals.serialNumber, serialNumber)
      ))
      .limit(1);

    return result ? this.mapToEntity(result) : null;
  }

  /**
   * Cross-tenant lookup by the central's own UUID (its `id`, the value the
   * device carries as the `UUID` claim in its poll-loop JWT). Tenant-agnostic:
   * the central does NOT know its tenant — it is derived from the returned row.
   * Returns the RAW row (incl. tenantId + agentSecret) for centralAuthMiddleware
   * to verify the HMAC and build req.context. Returns null if no such central.
   */
  async getByUuid(uuid: string): Promise<typeof centrals.$inferSelect | null> {
    const [row] = await db
      .select()
      .from(centrals)
      .where(eq(centrals.id, uuid))
      .limit(1);

    return row ?? null;
  }

  /**
   * Store a one-time enroll token (Slice 1.5). Operator path → tenant-aware.
   * Persists ONLY the sha256 hash of the token + its expiry; the plaintext is
   * never stored. Returns the updated row, or null if no such central in the
   * tenant. Re-issuing simply overwrites any prior pending token.
   */
  async setEnrollToken(
    tenantId: string,
    id: string,
    enrollTokenHash: string,
    enrollTokenExpiresAt: Date,
  ): Promise<typeof centrals.$inferSelect | null> {
    const [row] = await db
      .update(centrals)
      .set({
        enrollTokenHash,
        enrollTokenExpiresAt,
        updatedAt: new Date(),
      })
      .where(and(eq(centrals.tenantId, tenantId), eq(centrals.id, id)))
      .returning();

    return row ?? null;
  }

  /**
   * Finalize enrollment (Slice 1.5). Device-facing → cross-tenant by `id` (the
   * central only knows its own uuid). Persists the freshly-minted agent_secret,
   * stamps enrolled_at, and CLEARS the enroll token (hash + expiry).
   *
   * CR-S8: the UPDATE is CONDITIONAL on the enroll-token hash still being present
   * and matching `expectedEnrollTokenHash`, so mint-new + revoke-old happen in a
   * single compare-and-swap statement. Concurrent re-enrolls of the same token
   * (field-swap retry storm) therefore resolve to exactly ONE winner — the rest
   * match zero rows and get null. Returns the updated row, or null if no central
   * matched (unknown id OR the token was already consumed).
   */
  async completeEnrollment(
    id: string,
    expectedEnrollTokenHash: string,
    agentSecret: string,
    enrolledAt: Date,
  ): Promise<typeof centrals.$inferSelect | null> {
    const [row] = await db
      .update(centrals)
      .set({
        agentSecret,
        enrolledAt,
        enrollTokenHash: null,
        enrollTokenExpiresAt: null,
        updatedAt: new Date(),
      })
      .where(and(eq(centrals.id, id), eq(centrals.enrollTokenHash, expectedEnrollTokenHash)))
      .returning();

    return row ?? null;
  }

  /**
   * RFC-0056 — shallow-merge a partial `config` jsonb patch onto the central
   * row (e.g. `provisioningState`, `centralInitialApiKeyId`, `centralApiKeyId`).
   * Tenant-scoped like the rest of the write methods; both call sites
   * (bootstrap service, operator reset) already hold the resolved tenantId.
   * Returns the updated config, or null if no such central in the tenant.
   *
   * RFC-0056 (P1 fix) — accepts an optional tx client so the bootstrap
   * service can run this INSIDE the same transaction/lock as
   * `lockByIdQuery`, making read-check-mint-write atomic. Defaults to the
   * module-level `db` for existing callers (e.g. the operator reset flow)
   * that don't need the extra guarantee.
   */
  async patchConfig(
    tenantId: string,
    id: string,
    patch: Record<string, unknown>,
    client: CentralDbClient = db,
  ): Promise<Record<string, unknown> | null> {
    const [existing] = await client
      .select({ config: centrals.config })
      .from(centrals)
      .where(and(eq(centrals.tenantId, tenantId), eq(centrals.id, id)))
      .limit(1);
    if (!existing) return null;

    const [result] = await client
      .update(centrals)
      .set({
        config: { ...(existing.config as Record<string, unknown>), ...patch },
        updatedAt: new Date(),
      })
      .where(and(eq(centrals.tenantId, tenantId), eq(centrals.id, id)))
      .returning({ config: centrals.config });

    return (result?.config as Record<string, unknown>) ?? null;
  }

  async existsBySerialNumberGlobal(serialNumber: string): Promise<boolean> {
    const [row] = await db
      .select({ id: centrals.id })
      .from(centrals)
      .where(eq(centrals.serialNumber, serialNumber))
      .limit(1);

    return !!row;
  }

  async update(tenantId: string, id: string, data: UpdateCentralDTO, updatedBy: string): Promise<Central> {
    const existing = await this.getById(tenantId, id);
    if (!existing) {
      throw new AppError('CENTRAL_NOT_FOUND', 'Central not found', 404);
    }

    const updateData: Record<string, unknown> = {
      updatedAt: new Date(),
      updatedBy,
      version: existing.version + 1,
    };

    // Only update fields that are provided
    if (data.name !== undefined) updateData.name = data.name;
    if (data.displayName !== undefined) updateData.displayName = data.displayName;
    if (data.serialNumber !== undefined) updateData.serialNumber = data.serialNumber;
    if (data.firmwareVersion !== undefined) updateData.firmwareVersion = data.firmwareVersion;
    if (data.softwareVersion !== undefined) updateData.softwareVersion = data.softwareVersion;
    if (data.frequency !== undefined) updateData.frequency = data.frequency;
    if (data.location !== undefined) updateData.location = data.location;
    if (data.tags !== undefined) updateData.tags = data.tags;
    if (data.metadata !== undefined) updateData.metadata = { ...existing.metadata, ...data.metadata };

    // Merge config if provided
    if (data.config !== undefined) {
      updateData.config = { ...existing.config, ...data.config };
    }

    const [result] = await db
      .update(centrals)
      .set(updateData)
      .where(and(
        eq(centrals.tenantId, tenantId),
        eq(centrals.id, id),
        eq(centrals.version, existing.version) // Optimistic locking
      ))
      .returning();

    if (!result) {
      throw new AppError('CONCURRENT_UPDATE', 'Central was modified by another process', 409);
    }

    return this.mapToEntity(result);
  }

  async delete(tenantId: string, id: string): Promise<void> {
    await db
      .delete(centrals)
      .where(and(eq(centrals.tenantId, tenantId), eq(centrals.id, id)));
  }

  async list(tenantId: string, params: ListCentralsDTO): Promise<PaginatedResult<Central>> {
    const limit = params.limit || 20;
    const offset = params.cursor ? parseInt(params.cursor, 10) : 0;

    // Build conditions
    const conditions = [eq(centrals.tenantId, tenantId)];

    if (params.customerId) {
      conditions.push(eq(centrals.customerId, params.customerId));
    }

    if (params.assetId) {
      conditions.push(eq(centrals.assetId, params.assetId));
    }

    if (params.type) {
      conditions.push(eq(centrals.type, params.type));
    }

    if (params.status) {
      conditions.push(eq(centrals.status, params.status as 'ACTIVE' | 'INACTIVE' | 'DELETED'));
    }

    if (params.connectionStatus) {
      conditions.push(eq(centrals.connectionStatus, params.connectionStatus));
    }

    const [results, total] = await Promise.all([
      db.select()
        .from(centrals)
        .where(and(...conditions))
        .orderBy(centrals.createdAt)
        .limit(limit + 1)
        .offset(offset),
      countWhere(centrals, conditions),
    ]);

    const hasMore = results.length > limit;
    const items = hasMore ? results.slice(0, limit) : results;

    return {
      items: items.map(this.mapToEntity),
      pagination: {
        total,
        totalPages: Math.ceil(total / limit),
        hasMore,
        nextCursor: hasMore ? String(offset + limit) : undefined,
      },
    };
  }

  async listByCustomer(tenantId: string, customerId: string): Promise<Central[]> {
    const results = await db
      .select()
      .from(centrals)
      .where(and(
        eq(centrals.tenantId, tenantId),
        eq(centrals.customerId, customerId)
      ))
      .orderBy(centrals.name);

    return results.map(this.mapToEntity);
  }

  async listByAsset(tenantId: string, assetId: string): Promise<Central[]> {
    const results = await db
      .select()
      .from(centrals)
      .where(and(
        eq(centrals.tenantId, tenantId),
        eq(centrals.assetId, assetId)
      ))
      .orderBy(centrals.name);

    return results.map(this.mapToEntity);
  }

  async updateStatus(tenantId: string, id: string, status: EntityStatus, updatedBy: string): Promise<Central> {
    const existing = await this.getById(tenantId, id);
    if (!existing) {
      throw new AppError('CENTRAL_NOT_FOUND', 'Central not found', 404);
    }

    const timestamp = now();

    const [result] = await db
      .update(centrals)
      .set({
        status: status as 'ACTIVE' | 'INACTIVE' | 'DELETED',
        updatedAt: new Date(timestamp),
        updatedBy,
        version: existing.version + 1,
      })
      .where(and(
        eq(centrals.tenantId, tenantId),
        eq(centrals.id, id),
        eq(centrals.version, existing.version)
      ))
      .returning();

    if (!result) {
      throw new AppError('CONCURRENT_UPDATE', 'Central was modified by another process', 409);
    }

    return this.mapToEntity(result);
  }

  async updateConnectionStatus(
    tenantId: string,
    id: string,
    connectionStatus: ConnectionStatus,
    stats?: Partial<Central['stats']>
  ): Promise<Central> {
    const timestamp = now();

    const updateData: Record<string, unknown> = {
      connectionStatus,
      updatedAt: new Date(timestamp),
    };

    if (stats) {
      const existing = await this.getById(tenantId, id);
      if (existing) {
        updateData.stats = {
          ...existing.stats,
          ...stats,
          lastHeartbeatAt: timestamp,
        };
      }
    }

    const [result] = await db
      .update(centrals)
      .set(updateData)
      .where(and(eq(centrals.tenantId, tenantId), eq(centrals.id, id)))
      .returning();

    if (!result) {
      throw new AppError('CENTRAL_NOT_FOUND', 'Central not found', 404);
    }

    return this.mapToEntity(result);
  }

  async recordHeartbeat(tenantId: string, id: string, stats: Partial<Central['stats']>): Promise<void> {
    const timestamp = now();
    const existing = await this.getById(tenantId, id);

    if (!existing) {
      throw new AppError('CENTRAL_NOT_FOUND', 'Central not found', 404);
    }

    await db
      .update(centrals)
      .set({
        connectionStatus: 'ONLINE',
        stats: {
          ...existing.stats,
          ...stats,
          lastHeartbeatAt: timestamp,
        },
        updatedAt: new Date(timestamp),
      })
      .where(and(eq(centrals.tenantId, tenantId), eq(centrals.id, id)));
  }

  /**
   * Persist the central's hardware board (reported by its agent on poll via the
   * x-device-type header) into metadata.platform. Heartbeat-style: no version
   * bump / optimistic lock (like recordHeartbeat), so it never fights the
   * operator's update(). No-op when unchanged or the central is gone.
   */
  async recordPlatform(tenantId: string, id: string, platform: string): Promise<void> {
    const existing = await this.getById(tenantId, id);
    if (!existing) return;
    const current = (existing.metadata as Record<string, unknown> | undefined)?.platform;
    if (current === platform) return;
    await db
      .update(centrals)
      .set({
        metadata: { ...(existing.metadata as Record<string, unknown>), platform },
        updatedAt: new Date(now()),
      })
      .where(and(eq(centrals.tenantId, tenantId), eq(centrals.id, id)));
  }

  // SECURITY (CR-B2): this is the operator-facing allowlist. The credential
  // columns agent_secret / enroll_token_hash / enroll_token_expires_at /
  // enrolled_at are intentionally NOT mapped onto the Central entity, so they
  // can never reach a response body. Do NOT switch this to `...row` / a spread.
  private mapToEntity(row: typeof centrals.$inferSelect): Central {
    return {
      id: row.id,
      tenantId: row.tenantId,
      customerId: row.customerId,
      assetId: row.assetId,
      name: row.name,
      displayName: row.displayName,
      serialNumber: row.serialNumber,
      type: row.type,
      status: row.status,
      connectionStatus: row.connectionStatus,
      firmwareVersion: row.firmwareVersion,
      softwareVersion: row.softwareVersion,
      frequency: row.frequency,
      config: row.config as Central['config'],
      stats: row.stats as Central['stats'],
      location: row.location as Central['location'],
      tags: row.tags as string[],
      metadata: row.metadata as Record<string, unknown>,
      version: row.version,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      createdBy: row.createdBy || undefined,
      updatedBy: row.updatedBy || undefined,
    };
  }
}

// Export singleton instance
export const centralRepository = new CentralRepository();
