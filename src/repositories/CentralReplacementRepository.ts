// =============================================================================
// RFC-0005: Gateway (Central) Hardware Replacement — transactional repository
// =============================================================================
//
// `centrals.id` IS the hardware UUID, so new hardware is necessarily a new row;
// `serialNumber` is unique per tenant, so "free the serial on the old row,
// create the new row with it, repoint devices" cannot be three client calls
// without risking an orphaned intermediate state. This repository owns the
// whole operation in ONE db.transaction:
//
//   1. lock the old central row (SELECT ... FOR UPDATE);
//   2. idempotency: a prior successful GATEWAY_REPLACED ledger event with the
//      same replacementId replays the SAME stored result (no work redone);
//   3. validate: old central ACTIVE, newUuid unused (PK is global), IPv6 not
//      used by another ACTIVE central, reissued serial not colliding;
//   4. archive the old serial (`archived-<serial>-<epoch>` — schema forbids
//      null), status INACTIVE, metadata.replacedBy/replacedAt;
//   5. create the new central: id = newUuid, kept (or new) serial, same
//      customer/asset/name/frequency, config.ipv6Yggdrasil = new IPv6.
//      Agent credentials (agent_secret / enroll token) are NOT copied — the
//      new hardware must enroll fresh;
//   6. repoint every device of the old central (same tenant);
//   7. append the GATEWAY_REPLACED audit/ledger event with the full
//      replacement record — durable atomically with the swap itself.
//
// Query builders are exposed as public methods (called with the tx client) so
// their SQL shape is unit-testable without a database, mirroring
// CentralCommandRepository / EntityRepository.

import { and, eq, ne, sql } from 'drizzle-orm';
import { db, schema } from '../infrastructure/database/drizzle/db';
import { createDefaultCentralStats } from '../domain/entities/Central';
import {
  ReplaceCentralDTO,
  ReplaceCentralResult,
  ReplacedCentralSummary,
} from '../dto/request/CentralReplacementDTO';
import { ConflictError, NotFoundError } from '../shared/errors/AppError';
import { generateId } from '../shared/utils/idGenerator';
import { EventType } from '../shared/types';

const { centrals, devices, auditLogs } = schema;

/** The Drizzle transaction client passed to `db.transaction(async (tx) => …)`. */
export type ReplaceTx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type DbClient = typeof db | ReplaceTx;

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ReplaceActorContext {
  userId?: string;
  userEmail?: string;
  requestId?: string;
}

export interface ReplaceOutcome {
  result: ReplaceCentralResult;
  /** True when this call replayed a prior replacement (same replacementId). */
  replayed: boolean;
}

export class CentralReplacementRepository {

  // ---------------------------------------------------------------------------
  // Query builders (public for SQL-shape tests; executed with the tx client)
  // ---------------------------------------------------------------------------

  /** Lock the old central row for the whole transaction. */
  lockOldCentralQuery(tenantId: string, oldUuid: string, client: DbClient = db) {
    return client
      .select()
      .from(centrals)
      .where(and(eq(centrals.tenantId, tenantId), eq(centrals.id, oldUuid)))
      .limit(1)
      .for('update');
  }

  /** Prior GATEWAY_REPLACED ledger event carrying this replacementId (idempotency). */
  priorReplacementQuery(tenantId: string, replacementId: string, client: DbClient = db) {
    return client
      .select()
      .from(auditLogs)
      .where(and(
        eq(auditLogs.tenantId, tenantId),
        eq(auditLogs.eventType, EventType.GATEWAY_REPLACED),
        sql`${auditLogs.metadata}->>'replacementId' = ${replacementId}`,
      ))
      .limit(1);
  }

  /** Any central (any tenant — PK is global) already using the new UUID. */
  newUuidInUseQuery(newUuid: string, client: DbClient = db) {
    return client
      .select({ id: centrals.id })
      .from(centrals)
      .where(eq(centrals.id, newUuid))
      .limit(1);
  }

  /**
   * Another ACTIVE central already claiming the new IPv6. Global (network
   * identity is mesh-wide), excluding the central being replaced — the old
   * row is archived in the same transaction anyway.
   */
  ipv6InUseQuery(newIpv6: string, excludeCentralId: string, client: DbClient = db) {
    return client
      .select({ id: centrals.id })
      .from(centrals)
      .where(and(
        sql`${centrals.config}->>'ipv6Yggdrasil' = ${newIpv6}`,
        eq(centrals.status, 'ACTIVE'),
        ne(centrals.id, excludeCentralId),
      ))
      .limit(1);
  }

  /** A reissued serial colliding within the tenant (unique index scope). */
  serialInUseQuery(tenantId: string, serialNumber: string, excludeCentralId: string, client: DbClient = db) {
    return client
      .select({ id: centrals.id })
      .from(centrals)
      .where(and(
        eq(centrals.tenantId, tenantId),
        eq(centrals.serialNumber, serialNumber),
        ne(centrals.id, excludeCentralId),
      ))
      .limit(1);
  }

  /** Repoint every device of the old central to the new one (same tenant). */
  repointDevicesQuery(
    tenantId: string,
    oldUuid: string,
    newUuid: string,
    updatedBy: string | null,
    now: Date,
    client: DbClient = db,
  ) {
    return client
      .update(devices)
      .set({
        centralId: newUuid,
        updatedAt: now,
        updatedBy,
        version: sql`${devices.version} + 1`,
      })
      .where(and(eq(devices.tenantId, tenantId), eq(devices.centralId, oldUuid)))
      .returning({ id: devices.id });
  }

  // ---------------------------------------------------------------------------
  // The transactional command
  // ---------------------------------------------------------------------------

  async replace(
    tenantId: string,
    oldUuid: string,
    input: ReplaceCentralDTO,
    actor: ReplaceActorContext,
  ): Promise<ReplaceOutcome> {
    return db.transaction(async (tx) => {
      // 1. Lock the old central row FIRST — serializes concurrent replacements
      //    of the same central; a same-replacementId retry blocks here and then
      //    observes the committed ledger event below.
      const [old] = await this.lockOldCentralQuery(tenantId, oldUuid, tx);

      // 2. Idempotency — checked under the lock so a retry that raced the
      //    original cannot pass validation against pre-replacement state.
      const [prior] = await this.priorReplacementQuery(tenantId, input.replacementId, tx);
      if (prior) {
        const record = (prior.metadata ?? {}) as Record<string, unknown>;
        const storedResult = record.result as ReplaceCentralResult | undefined;
        if (
          record.oldHardwareUuid === oldUuid &&
          record.newHardwareUuid === input.newUuid &&
          storedResult
        ) {
          return { result: storedResult, replayed: true };
        }
        throw new ConflictError(
          `replacementId ${input.replacementId} was already used for a different replacement`,
        );
      }

      // 3. Validations (no prior event → this must be a fresh replacement).
      if (!old) {
        throw new NotFoundError(`Central ${oldUuid} not found`);
      }
      if (old.status !== 'ACTIVE') {
        const replacedBy = (old.metadata as Record<string, unknown> | null)?.replacedBy;
        throw new ConflictError(
          replacedBy
            ? `Central ${oldUuid} was already replaced by ${String(replacedBy)}`
            : `Central ${oldUuid} is not ACTIVE (status ${old.status}) and cannot be replaced`,
        );
      }

      const [uuidClash] = await this.newUuidInUseQuery(input.newUuid, tx);
      if (uuidClash) {
        throw new ConflictError(`UUID ${input.newUuid} is already used by another central`);
      }

      const [ipv6Clash] = await this.ipv6InUseQuery(input.newIpv6Yggdrasil, oldUuid, tx);
      if (ipv6Clash) {
        throw new ConflictError(
          `IPv6 ${input.newIpv6Yggdrasil} is already used by active central ${ipv6Clash.id}`,
        );
      }

      const keepSerial = input.keepSerialNumber !== false;
      const newSerial = keepSerial ? old.serialNumber : (input.newSerialNumber as string);
      if (!keepSerial) {
        const [serialClash] = await this.serialInUseQuery(tenantId, newSerial, oldUuid, tx);
        if (serialClash) {
          throw new ConflictError(`Serial number ${newSerial} is already used by another central`);
        }
      }

      const now = new Date();
      const nowIso = now.toISOString();
      const epoch = now.getTime();
      const updatedBy = actor.userId ?? null;
      const oldConfig = (old.config ?? {}) as Record<string, unknown>;
      const oldMetadata = (old.metadata ?? {}) as Record<string, unknown>;
      const oldIpv6 = typeof oldConfig.ipv6Yggdrasil === 'string' ? oldConfig.ipv6Yggdrasil : null;

      // 4. Archive the old serial + retire the old row (retired, not deleted —
      //    audit trail and ledger history stay attached to it). serial_number
      //    is NOT NULL + unique, hence the archived-rename (RFC Unresolved #4).
      //    varchar(100): 'archived-' (9) + serial (≤77) + '-' + epoch (13).
      const archivedSerial = `archived-${old.serialNumber.slice(0, 77)}-${epoch}`;
      const [archivedOld] = await tx
        .update(centrals)
        .set({
          serialNumber: archivedSerial,
          status: 'INACTIVE',
          connectionStatus: 'OFFLINE',
          metadata: {
            ...oldMetadata,
            replacedBy: input.newUuid,
            replacedAt: nowIso,
            replacementId: input.replacementId,
          },
          updatedAt: now,
          updatedBy,
          version: old.version + 1,
        })
        .where(and(
          eq(centrals.tenantId, tenantId),
          eq(centrals.id, oldUuid),
          eq(centrals.version, old.version), // belt & braces under the row lock
        ))
        .returning();

      if (!archivedOld) {
        throw new ConflictError('Central was modified by another process during replacement');
      }

      // 5. Create the new central row — the old one's exact place in the
      //    hierarchy, with the new hardware identity. Stats reset; agent
      //    credentials intentionally not carried over (fresh enrollment).
      const [created] = await tx
        .insert(centrals)
        .values({
          id: input.newUuid,
          tenantId,
          customerId: old.customerId,
          assetId: old.assetId,
          name: old.name,
          displayName: old.displayName,
          serialNumber: newSerial,
          type: old.type,
          status: 'ACTIVE',
          connectionStatus: 'OFFLINE',
          firmwareVersion: old.firmwareVersion,
          softwareVersion: old.softwareVersion,
          frequency: old.frequency,
          config: { ...oldConfig, ipv6Yggdrasil: input.newIpv6Yggdrasil },
          stats: createDefaultCentralStats(),
          location: old.location,
          tags: old.tags,
          metadata: {
            ...oldMetadata,
            replacedFrom: oldUuid,
            replacedAt: nowIso,
            replacementId: input.replacementId,
          },
          version: 1,
          createdAt: now,
          updatedAt: now,
          createdBy: updatedBy,
        })
        .returning();

      // 6. Repoint all devices of the old central (composite identity
      //    (tenant, central, slaveId, channel) preserved — slave IDs unchanged).
      const repointed = await this.repointDevicesQuery(
        tenantId, oldUuid, input.newUuid, updatedBy, now, tx,
      );
      const devicesRepointed = repointed.length;

      const result: ReplaceCentralResult = {
        replacementId: input.replacementId,
        oldCentral: this.toSummary(archivedOld),
        newCentral: this.toSummary(created),
        devicesRepointed,
      };

      // 7. The authoritative ledger event — inside the transaction, so the
      //    replacement record (RFC-0005 "Durable replacement state") is durable
      //    iff the swap itself committed. Written directly (NOT via the
      //    fire-and-forget logEvent middleware) precisely for that atomicity;
      //    the route therefore must NOT also wrap logEvent for this eventType.
      await tx.insert(auditLogs).values({
        id: generateId(),
        tenantId,
        eventType: EventType.GATEWAY_REPLACED,
        eventCategory: 'ENTITY_CHANGE',
        auditLevel: 'MINIMAL',
        description: `Central ${oldUuid} replaced by ${input.newUuid} ` +
          `(serial ${keepSerial ? 'kept' : 'reissued'}: ${newSerial}); ` +
          `${devicesRepointed} devices repointed`,
        action: 'EXECUTE',
        entityType: 'central',
        entityId: input.newUuid,
        customerId: old.customerId,
        userId: actor.userId,
        userEmail: actor.userEmail,
        actorType: 'USER',
        oldValues: {
          centralId: oldUuid,
          serialNumber: old.serialNumber,
          ipv6Yggdrasil: oldIpv6,
          status: 'ACTIVE',
        },
        newValues: {
          centralId: input.newUuid,
          serialNumber: newSerial,
          ipv6Yggdrasil: input.newIpv6Yggdrasil,
          status: 'ACTIVE',
        },
        requestId: actor.requestId && UUID_REGEX.test(actor.requestId) ? actor.requestId : undefined,
        metadata: {
          // The RFC-0005 replacement record. `result` doubles as the stored
          // response for idempotent replays.
          replacementId: input.replacementId,
          oldHardwareUuid: oldUuid,
          newHardwareUuid: input.newUuid,
          oldIpv6,
          newIpv6: input.newIpv6Yggdrasil,
          serialNumber: newSerial,
          serialReissued: !keepSerial,
          oldSerialArchivedAs: archivedSerial,
          devicesRepointed,
          operator: actor.userId ?? null,
          startedAt: nowIso,
          completedAt: nowIso,
          result,
        },
      });

      return { result, replayed: false };
    });
  }

  private toSummary(row: typeof centrals.$inferSelect): ReplacedCentralSummary {
    const config = (row.config ?? {}) as Record<string, unknown>;
    return {
      id: row.id,
      serialNumber: row.serialNumber,
      name: row.name,
      displayName: row.displayName,
      status: row.status,
      customerId: row.customerId,
      assetId: row.assetId,
      frequency: row.frequency,
      ipv6Yggdrasil: typeof config.ipv6Yggdrasil === 'string' ? config.ipv6Yggdrasil : null,
    };
  }
}

export const centralReplacementRepository = new CentralReplacementRepository();
