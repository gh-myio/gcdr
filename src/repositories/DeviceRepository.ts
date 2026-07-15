import { eq, and, sql, lt, isNull, isNotNull, inArray } from 'drizzle-orm';
import { db, schema } from '../infrastructure/database/drizzle/db';
import { Device, ConnectivityStatus, createDefaultDeviceSpecs, createDefaultTelemetryConfig } from '../domain/entities/Device';
import { CreateDeviceDTO, UpdateDeviceDTO, ListDevicesParams } from '../dto/request/DeviceDTO';
import { PaginatedResult } from '../shared/types';
import { IDeviceRepository } from './interfaces/IDeviceRepository';
import { generateId } from '../shared/utils/idGenerator';
import { now } from '../shared/utils/dateUtils';
import { AppError } from '../shared/errors/AppError';
import { countWhere } from './helpers/countQuery';

const { devices } = schema;

const DEVICE_NOT_FOUND_MSG = 'Device not found';

/**
 * UpdateDeviceDTO fields copied verbatim into the row when present. Merge
 * fields (specs, telemetryConfig, metadata, attributes) are handled explicitly
 * in `update`.
 */
const UPDATE_COPY_FIELDS = [
  'name',
  'displayName',
  'code',
  'label',
  'type',
  'description',
  'externalId',
  'credentials',
  'tags',
  'status',
  // RFC-0008
  'slaveId',
  'centralId',
  'identifier',
  'deviceProfile',
  'deviceType',
  'channel',
  'deviceChannelType',
  'ingestionId',
  'ingestionGatewayId',
  // RFC-0046 Addendum A (DEC-11): set/clear together (validated upstream).
  'meterRole',
  'meterDomain',
] as const;

/**
 * Builds the smart full-text search condition across all relevant text columns.
 * Covers: name, displayName, label, code, serialNumber, externalId, identifier, metadata (as text).
 */
function buildSearchCondition(term: string) {
  const q = `%${term}%`;
  return sql`(
    ${devices.name}        ILIKE ${q} OR
    ${devices.displayName} ILIKE ${q} OR
    ${devices.label}       ILIKE ${q} OR
    ${devices.code}        ILIKE ${q} OR
    ${devices.serialNumber} ILIKE ${q} OR
    ${devices.externalId}  ILIKE ${q} OR
    ${devices.identifier}  ILIKE ${q} OR
    ${devices.metadata}::text ILIKE ${q}
  )`;
}

/**
 * Appends the shared filter conditions that apply to all list variants.
 */
function applyCommonFilters(conditions: ReturnType<typeof sql>[], params: ListDevicesParams) {
  if (params.type) {
    conditions.push(eq(devices.type, params.type as typeof devices.type.enumValues[number]));
  }
  if (params.status) {
    conditions.push(eq(devices.status, params.status as 'ACTIVE' | 'INACTIVE' | 'DELETED'));
  }
  if (params.connectivityStatus) {
    conditions.push(eq(devices.connectivityStatus, params.connectivityStatus as typeof devices.connectivityStatus.enumValues[number]));
  }
  if (params.centralId) {
    conditions.push(eq(devices.centralId, params.centralId));
  }
  if (params.slaveId !== undefined) {
    conditions.push(eq(devices.slaveId, params.slaveId));
  }
  if (params.deviceProfile) {
    conditions.push(eq(devices.deviceProfile, params.deviceProfile));
  }
  if (params.identifier) {
    conditions.push(eq(devices.identifier, params.identifier));
  }
  if (params.ingestionId) {
    conditions.push(eq(devices.ingestionId, params.ingestionId));
  }
  if (params.ingestionGatewayId) {
    conditions.push(eq(devices.ingestionGatewayId, params.ingestionGatewayId));
  }
  if (params.label) {
    conditions.push(eq(devices.label, params.label));
  }
  if (params.externalId) {
    conditions.push(eq(devices.externalId, params.externalId));
  }
  if (params.search) {
    conditions.push(buildSearchCondition(params.search));
  }
}

export class DeviceRepository implements IDeviceRepository {

  async create(tenantId: string, data: CreateDeviceDTO, customerId: string, createdBy: string): Promise<Device> {
    const id = generateId();
    const timestamp = now();

    const [result] = await db.insert(devices).values({
      id,
      tenantId,
      assetId: data.assetId,
      customerId,
      name: data.name,
      displayName: data.displayName || data.name,
      code: data.code,
      label: data.label,
      type: data.type,
      description: data.description,
      serialNumber: data.serialNumber || `AUTO-${id.substring(0, 8)}`,
      externalId: data.externalId,
      specs: {
        ...(data.specs || createDefaultDeviceSpecs(data.serialNumber || `AUTO-${id.substring(0, 8)}`)),
        ...(data.manufacturer !== undefined && { manufacturer: data.manufacturer }),
        ...(data.model !== undefined && { model: data.model }),
        ...(data.firmwareVersion !== undefined && { firmwareVersion: data.firmwareVersion }),
      },
      connectivityStatus: 'UNKNOWN',
      credentials: data.credentials || {},
      telemetryConfig: data.telemetryConfig || createDefaultTelemetryConfig(),
      tags: data.tags || [],
      metadata: data.metadata || {},
      attributes: data.attributes || {},
      status: 'ACTIVE',
      version: 1,
      createdAt: new Date(timestamp),
      updatedAt: new Date(timestamp),
      createdBy,
      // RFC-0008: New fields
      slaveId: data.slaveId,
      centralId: data.centralId,
      identifier: data.identifier,
      deviceProfile: data.deviceProfile,
      deviceType: data.deviceType,
      channel: data.channel,
      deviceChannelType: data.deviceChannelType,
      ingestionId: data.ingestionId,
      ingestionGatewayId: data.ingestionGatewayId,
      // RFC-0046 Addendum A (DEC-11)
      meterRole: data.meterRole ?? null,
      meterDomain: data.meterDomain ?? null,
    }).returning();

    return this.mapToEntity(result);
  }

  async getById(tenantId: string, id: string): Promise<Device | null> {
    const [result] = await db
      .select()
      .from(devices)
      .where(and(eq(devices.tenantId, tenantId), eq(devices.id, id)))
      .limit(1);

    return result ? this.mapToEntity(result) : null;
  }

  async countByName(
    tenantId: string,
    name: string,
    opts?: { customerIds?: string[]; caseSensitive?: boolean },
  ): Promise<number> {
    const caseSensitive = opts?.caseSensitive !== false; // default true

    const nameCondition = caseSensitive
      ? eq(devices.name, name)
      : sql`lower(${devices.name}) = lower(${name})`;

    const conditions = [
      eq(devices.tenantId, tenantId),
      nameCondition,
    ];
    if (opts?.customerIds && opts.customerIds.length > 0) {
      conditions.push(inArray(devices.customerId, opts.customerIds));
    }

    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(devices)
      .where(and(...conditions));

    return row?.count ?? 0;
  }

  async getBySerialNumber(tenantId: string, serialNumber: string): Promise<Device | null> {
    const [result] = await db
      .select()
      .from(devices)
      .where(and(
        eq(devices.tenantId, tenantId),
        eq(devices.serialNumber, serialNumber)
      ))
      .limit(1);

    return result ? this.mapToEntity(result) : null;
  }

  async getByExternalId(tenantId: string, externalId: string): Promise<Device | null> {
    const [result] = await db
      .select()
      .from(devices)
      .where(and(
        eq(devices.tenantId, tenantId),
        eq(devices.externalId, externalId)
      ))
      .limit(1);

    return result ? this.mapToEntity(result) : null;
  }

  async update(tenantId: string, id: string, data: UpdateDeviceDTO, updatedBy: string): Promise<Device> {
    const existing = await this.getById(tenantId, id);
    if (!existing) {
      throw new AppError('DEVICE_NOT_FOUND', DEVICE_NOT_FOUND_MSG, 404);
    }

    const updateData: Record<string, unknown> = {
      updatedAt: new Date(),
      updatedBy,
      version: existing.version + 1,
    };

    // Only update fields that are provided (verbatim copies).
    const patch = data as Record<string, unknown>;
    for (const field of UPDATE_COPY_FIELDS) {
      if (patch[field] !== undefined) updateData[field] = patch[field];
    }

    // Merge fields: shallow-merge over the existing row.
    const specsOverride: Record<string, unknown> = {};
    if (data.manufacturer !== undefined) specsOverride.manufacturer = data.manufacturer;
    if (data.model !== undefined) specsOverride.model = data.model;
    if (data.firmwareVersion !== undefined) specsOverride.firmwareVersion = data.firmwareVersion;
    if (data.specs !== undefined || Object.keys(specsOverride).length > 0) {
      updateData.specs = { ...existing.specs, ...(data.specs || {}), ...specsOverride };
    }
    if (data.telemetryConfig !== undefined) updateData.telemetryConfig = { ...existing.telemetryConfig, ...data.telemetryConfig };
    if (data.metadata !== undefined) updateData.metadata = { ...existing.metadata, ...data.metadata };
    if (data.attributes !== undefined) updateData.attributes = { ...existing.attributes, ...data.attributes };

    const [result] = await db
      .update(devices)
      .set(updateData)
      .where(and(
        eq(devices.tenantId, tenantId),
        eq(devices.id, id),
        eq(devices.version, existing.version) // Optimistic locking
      ))
      .returning();

    if (!result) {
      throw new AppError('CONCURRENT_UPDATE', 'Device was modified by another process', 409);
    }

    return this.mapToEntity(result);
  }

  async delete(tenantId: string, id: string): Promise<void> {
    await db
      .delete(devices)
      .where(and(eq(devices.tenantId, tenantId), eq(devices.id, id)));
  }

  async list(tenantId: string, params?: ListDevicesParams): Promise<PaginatedResult<Device>> {
    const limit = params?.limit || 20;
    const offset = params?.cursor ? parseInt(params.cursor, 10) : 0;

    // Build conditions
    const conditions = [eq(devices.tenantId, tenantId)];

    if (params?.customerIds && params.customerIds.length > 0) {
      conditions.push(inArray(devices.customerId, params.customerIds));
    } else if (params?.customerId) {
      conditions.push(eq(devices.customerId, params.customerId));
    }

    if (params) applyCommonFilters(conditions, params);

    const [results, total] = await Promise.all([
      db.select()
        .from(devices)
        .where(and(...conditions))
        .orderBy(devices.createdAt)
        .limit(limit + 1)
        .offset(offset),
      countWhere(devices, conditions),
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

  async listByAsset(tenantId: string, assetId: string, params?: ListDevicesParams): Promise<PaginatedResult<Device>> {
    const limit = params?.limit || 20;
    const offset = params?.cursor ? parseInt(params.cursor, 10) : 0;

    // Build conditions
    const conditions = [
      eq(devices.tenantId, tenantId),
      eq(devices.assetId, assetId),
    ];

    if (params) applyCommonFilters(conditions, params);

    const [results, total] = await Promise.all([
      db.select()
        .from(devices)
        .where(and(...conditions))
        .orderBy(devices.name)
        .limit(limit + 1)
        .offset(offset),
      countWhere(devices, conditions),
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

  async listByCustomer(tenantId: string, customerId: string, params?: ListDevicesParams): Promise<PaginatedResult<Device>> {
    const limit = params?.limit || 20;
    const offset = params?.cursor ? parseInt(params.cursor, 10) : 0;

    // Build conditions
    const conditions = [
      eq(devices.tenantId, tenantId),
      eq(devices.customerId, customerId),
    ];

    if (params) applyCommonFilters(conditions, params);

    const [results, total] = await Promise.all([
      db.select()
        .from(devices)
        .where(and(...conditions))
        .orderBy(devices.name)
        .limit(limit + 1)
        .offset(offset),
      countWhere(devices, conditions),
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

  async updateConnectivityStatus(tenantId: string, id: string, status: ConnectivityStatus): Promise<Device> {
    const timestamp = new Date();
    const updateData: Record<string, unknown> = {
      connectivityStatus: status,
      updatedAt: timestamp,
    };

    if (status === 'ONLINE') {
      updateData.lastConnectedAt = timestamp;
    } else if (status === 'OFFLINE') {
      updateData.lastDisconnectedAt = timestamp;
    }

    const [result] = await db
      .update(devices)
      .set(updateData)
      .where(and(eq(devices.tenantId, tenantId), eq(devices.id, id)))
      .returning();

    if (!result) {
      throw new AppError('DEVICE_NOT_FOUND', 'DEVICE_NOT_FOUND_MSG', 404);
    }

    return this.mapToEntity(result);
  }

  async move(tenantId: string, deviceId: string, newAssetId: string, newCustomerId: string, updatedBy: string): Promise<Device> {
    const [result] = await db
      .update(devices)
      .set({
        assetId: newAssetId,
        customerId: newCustomerId,
        updatedAt: new Date(),
        updatedBy,
      })
      .where(and(eq(devices.tenantId, tenantId), eq(devices.id, deviceId)))
      .returning();

    if (!result) {
      throw new AppError('DEVICE_NOT_FOUND', 'DEVICE_NOT_FOUND_MSG', 404);
    }

    return this.mapToEntity(result);
  }

  async countByAsset(tenantId: string, assetId: string): Promise<number> {
    const result = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(devices)
      .where(and(
        eq(devices.tenantId, tenantId),
        eq(devices.assetId, assetId)
      ));

    return result[0]?.count || 0;
  }

  async countByCustomer(tenantId: string, customerId: string): Promise<number> {
    const result = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(devices)
      .where(and(
        eq(devices.tenantId, tenantId),
        eq(devices.customerId, customerId)
      ));

    return result[0]?.count || 0;
  }

  async countByConnectivityStatus(
    tenantId: string,
  ): Promise<{ total: number; byConnectivity: Record<string, number> }> {
    const rows = await db
      .select({
        status: devices.connectivityStatus,
        count: sql<number>`count(*)::int`,
      })
      .from(devices)
      .where(and(
        eq(devices.tenantId, tenantId),
        sql`${devices.deletedAt} is null`,
      ))
      .groupBy(devices.connectivityStatus);

    const byConnectivity: Record<string, number> = {};
    let total = 0;
    for (const row of rows) {
      byConnectivity[row.status] = row.count;
      total += row.count;
    }

    return { total, byConnectivity };
  }

  private mapToEntity(row: typeof devices.$inferSelect): Device {
    return {
      id: row.id,
      tenantId: row.tenantId,
      assetId: row.assetId,
      customerId: row.customerId,
      name: row.name,
      displayName: row.displayName,
      code: row.code || undefined,
      label: row.label || undefined,
      type: row.type,
      description: row.description || undefined,
      serialNumber: row.serialNumber || '',
      externalId: row.externalId || undefined,
      specs: row.specs as Device['specs'],
      connectivityStatus: row.connectivityStatus,
      credentials: row.credentials as Device['credentials'],
      telemetryConfig: row.telemetryConfig as Device['telemetryConfig'],
      tags: row.tags as string[],
      metadata: row.metadata as Record<string, unknown>,
      attributes: row.attributes as Record<string, unknown>,
      status: row.status,
      lastConnectedAt: row.lastConnectedAt?.toISOString(),
      lastDisconnectedAt: row.lastDisconnectedAt?.toISOString(),
      deletedAt: row.deletedAt?.toISOString(),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      createdBy: row.createdBy || undefined,
      updatedBy: row.updatedBy || undefined,
      version: row.version,
      // RFC-0008: New fields
      slaveId: row.slaveId || undefined,
      centralId: row.centralId || undefined,
      identifier: row.identifier || undefined,
      deviceProfile: row.deviceProfile || undefined,
      deviceType: row.deviceType || undefined,
      channel: row.channel ?? undefined,
      deviceChannelType: row.deviceChannelType || undefined,
      meterRole: (row.meterRole as Device['meterRole']) || undefined,
      meterDomain: (row.meterDomain as Device['meterDomain']) || undefined,
      ingestionId: row.ingestionId || undefined,
      ingestionGatewayId: row.ingestionGatewayId || undefined,
      lastActivityTime: row.lastActivityTime?.toISOString(),
      lastAlarmTime: row.lastAlarmTime?.toISOString(),
    };
  }

  // ===========================================================================
  // RFC-0046 Addendum A (DEC-11): entry-meter resolution for goal allocation
  // ===========================================================================

  /**
   * The authoritative ENTRY-meter set for a (tenant, customer, goal domain):
   * active, not soft-deleted, explicitly classified `meter_role='ENTRY'` with
   * the matching `meter_domain`. NOTHING is inferred — an unclassified meter
   * never enters the residual pool (DEC-11).
   */
  async findEntryMeters(
    tenantId: string,
    customerId: string,
    meterDomain: 'ENERGY' | 'WATER',
  ): Promise<Device[]> {
    const rows = await db
      .select()
      .from(devices)
      .where(and(
        eq(devices.tenantId, tenantId),
        eq(devices.customerId, customerId),
        eq(devices.meterRole, 'ENTRY'),
        eq(devices.meterDomain, meterDomain),
        eq(devices.status, 'ACTIVE'),
        isNull(devices.deletedAt),
      ))
      .orderBy(devices.code, devices.name);

    return rows.map((r) => this.mapToEntity(r));
  }

  /** Bulk fetch by ids (tenant-scoped) — used to label goal device summaries. */
  async findByIds(tenantId: string, ids: string[]): Promise<Device[]> {
    if (ids.length === 0) return [];
    const rows = await db
      .select()
      .from(devices)
      .where(and(eq(devices.tenantId, tenantId), inArray(devices.id, ids)));
    return rows.map((r) => this.mapToEntity(r));
  }

  // ===========================================================================
  // RFC-0008: New Query Methods
  // ===========================================================================

  async findByCentralId(tenantId: string, centralId: string, params?: ListDevicesParams): Promise<PaginatedResult<Device>> {
    const limit = params?.limit || 20;
    const offset = params?.cursor ? parseInt(params.cursor, 10) : 0;

    const conditions = [
      eq(devices.tenantId, tenantId),
      eq(devices.centralId, centralId),
    ];

    if (params?.status) {
      conditions.push(eq(devices.status, params.status as 'ACTIVE' | 'INACTIVE' | 'DELETED'));
    }

    const [results, total] = await Promise.all([
      db.select()
        .from(devices)
        .where(and(...conditions))
        .orderBy(devices.name)
        .limit(limit + 1)
        .offset(offset),
      countWhere(devices, conditions),
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

  async listByIds(tenantId: string, ids: string[]): Promise<Device[]> {
    if (ids.length === 0) return [];
    const results = await db
      .select()
      .from(devices)
      .where(and(eq(devices.tenantId, tenantId), inArray(devices.id, ids)))
      .orderBy(devices.name);
    return results.map(this.mapToEntity);
  }

  async findBySlaveId(
    tenantId: string,
    centralId: string,
    slaveId: number,
    channel?: number | null,
    deviceChannelType?: string | null,
  ): Promise<Device | null> {
    // Match the `devices_tenant_central_slave_channel_unique` index, which uses
    // NULLS NOT DISTINCT: an absent (null/undefined) channel/type matches an
    // existing row whose column is NULL, so the conflict check mirrors the DB key.
    const channelMissing = channel === null || channel === undefined;
    const typeMissing = deviceChannelType === null || deviceChannelType === undefined;
    const channelCond = channelMissing ? isNull(devices.channel) : eq(devices.channel, channel);
    const typeCond = typeMissing
      ? isNull(devices.deviceChannelType)
      : eq(devices.deviceChannelType, deviceChannelType);

    const [result] = await db
      .select()
      .from(devices)
      .where(and(
        eq(devices.tenantId, tenantId),
        eq(devices.centralId, centralId),
        eq(devices.slaveId, slaveId),
        channelCond,
        typeCond,
      ))
      .limit(1);

    return result ? this.mapToEntity(result) : null;
  }

  async findByIdentifier(tenantId: string, identifier: string): Promise<Device | null> {
    const [result] = await db
      .select()
      .from(devices)
      .where(and(
        eq(devices.tenantId, tenantId),
        eq(devices.identifier, identifier)
      ))
      .limit(1);

    return result ? this.mapToEntity(result) : null;
  }

  // RFC-0032: lookup by (customer, addrLow, addrHigh) — the legacy QR
  // payload format that the field operator scans. The columns were added
  // in migration 0025; partial index `idx_devices_wo_addr` covers this.
  async findByWoAddress(
    tenantId: string,
    customerId: string,
    addrLow: number,
    addrHigh: number,
  ): Promise<Device | null> {
    const [result] = await db
      .select()
      .from(devices)
      .where(and(
        eq(devices.tenantId, tenantId),
        eq(devices.customerId, customerId),
        eq(devices.woAddrLow, addrLow),
        eq(devices.woAddrHigh, addrHigh),
      ))
      .limit(1);

    return result ? this.mapToEntity(result) : null;
  }

  async findByProfile(tenantId: string, deviceProfile: string, params?: ListDevicesParams): Promise<PaginatedResult<Device>> {
    const limit = params?.limit || 20;
    const offset = params?.cursor ? parseInt(params.cursor, 10) : 0;

    const conditions = [
      eq(devices.tenantId, tenantId),
      eq(devices.deviceProfile, deviceProfile),
    ];

    if (params?.status) {
      conditions.push(eq(devices.status, params.status as 'ACTIVE' | 'INACTIVE' | 'DELETED'));
    }

    const [results, total] = await Promise.all([
      db.select()
        .from(devices)
        .where(and(...conditions))
        .orderBy(devices.name)
        .limit(limit + 1)
        .offset(offset),
      countWhere(devices, conditions),
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

  async findByDeviceType(tenantId: string, deviceType: string, params?: ListDevicesParams): Promise<PaginatedResult<Device>> {
    const limit = params?.limit || 20;
    const offset = params?.cursor ? parseInt(params.cursor, 10) : 0;

    const conditions = [
      eq(devices.tenantId, tenantId),
      eq(devices.deviceType, deviceType),
    ];

    if (params?.status) {
      conditions.push(eq(devices.status, params.status as 'ACTIVE' | 'INACTIVE' | 'DELETED'));
    }

    const [results, total] = await Promise.all([
      db.select()
        .from(devices)
        .where(and(...conditions))
        .orderBy(devices.name)
        .limit(limit + 1)
        .offset(offset),
      countWhere(devices, conditions),
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

  async findInactive(tenantId: string, options: { hours: number }): Promise<Device[]> {
    const threshold = new Date(Date.now() - options.hours * 60 * 60 * 1000);

    const results = await db
      .select()
      .from(devices)
      .where(and(
        eq(devices.tenantId, tenantId),
        eq(devices.status, 'ACTIVE'),
        isNotNull(devices.lastActivityTime),
        lt(devices.lastActivityTime, threshold)
      ))
      .orderBy(devices.lastActivityTime);

    return results.map(this.mapToEntity);
  }

  async findByIngestionId(tenantId: string, ingestionId: string): Promise<Device | null> {
    const [result] = await db
      .select()
      .from(devices)
      .where(and(
        eq(devices.tenantId, tenantId),
        eq(devices.ingestionId, ingestionId)
      ))
      .limit(1);

    return result ? this.mapToEntity(result) : null;
  }

  async updateLastActivityTime(tenantId: string, id: string): Promise<Device> {
    const timestamp = new Date();

    const [result] = await db
      .update(devices)
      .set({
        lastActivityTime: timestamp,
        updatedAt: timestamp,
      })
      .where(and(eq(devices.tenantId, tenantId), eq(devices.id, id)))
      .returning();

    if (!result) {
      throw new AppError('DEVICE_NOT_FOUND', 'DEVICE_NOT_FOUND_MSG', 404);
    }

    return this.mapToEntity(result);
  }

  async updateLastAlarmTime(tenantId: string, id: string): Promise<Device> {
    const timestamp = new Date();

    const [result] = await db
      .update(devices)
      .set({
        lastAlarmTime: timestamp,
        updatedAt: timestamp,
      })
      .where(and(eq(devices.tenantId, tenantId), eq(devices.id, id)))
      .returning();

    if (!result) {
      throw new AppError('DEVICE_NOT_FOUND', 'DEVICE_NOT_FOUND_MSG', 404);
    }

    return this.mapToEntity(result);
  }
}

// Export singleton instance
export const deviceRepository = new DeviceRepository();
