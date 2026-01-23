import { eq, and, sql } from 'drizzle-orm';
import { db, schema } from '../infrastructure/database/drizzle/db';
import { Device, ConnectivityStatus, createDefaultDeviceSpecs, createDefaultTelemetryConfig } from '../domain/entities/Device';
import { CreateDeviceDTO, UpdateDeviceDTO, ListDevicesParams } from '../dto/request/DeviceDTO';
import { PaginatedResult } from '../shared/types';
import { IDeviceRepository } from './interfaces/IDeviceRepository';
import { generateId } from '../shared/utils/idGenerator';
import { now } from '../shared/utils/dateUtils';
import { AppError } from '../shared/errors/AppError';

const { devices } = schema;

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
      label: data.label,
      type: data.type,
      description: data.description,
      serialNumber: data.serialNumber,
      externalId: data.externalId,
      specs: data.specs || createDefaultDeviceSpecs(data.serialNumber),
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
      throw new AppError('DEVICE_NOT_FOUND', 'Device not found', 404);
    }

    const updateData: Record<string, unknown> = {
      updatedAt: new Date(),
      updatedBy,
      version: existing.version + 1,
    };

    // Only update fields that are provided
    if (data.name !== undefined) updateData.name = data.name;
    if (data.displayName !== undefined) updateData.displayName = data.displayName;
    if (data.label !== undefined) updateData.label = data.label;
    if (data.type !== undefined) updateData.type = data.type;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.externalId !== undefined) updateData.externalId = data.externalId;
    if (data.specs !== undefined) updateData.specs = { ...existing.specs, ...data.specs };
    if (data.credentials !== undefined) updateData.credentials = data.credentials;
    if (data.telemetryConfig !== undefined) updateData.telemetryConfig = { ...existing.telemetryConfig, ...data.telemetryConfig };
    if (data.tags !== undefined) updateData.tags = data.tags;
    if (data.metadata !== undefined) updateData.metadata = { ...existing.metadata, ...data.metadata };
    if (data.attributes !== undefined) updateData.attributes = { ...existing.attributes, ...data.attributes };
    if (data.status !== undefined) updateData.status = data.status;

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

    if (params?.type) {
      conditions.push(eq(devices.type, params.type as typeof devices.type.enumValues[number]));
    }

    if (params?.status) {
      conditions.push(eq(devices.status, params.status as 'ACTIVE' | 'INACTIVE' | 'DELETED'));
    }

    if (params?.connectivityStatus) {
      conditions.push(eq(devices.connectivityStatus, params.connectivityStatus as typeof devices.connectivityStatus.enumValues[number]));
    }

    const results = await db
      .select()
      .from(devices)
      .where(and(...conditions))
      .orderBy(devices.createdAt)
      .limit(limit + 1)
      .offset(offset);

    const hasMore = results.length > limit;
    const items = hasMore ? results.slice(0, limit) : results;

    return {
      items: items.map(this.mapToEntity),
      pagination: {
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

    if (params?.type) {
      conditions.push(eq(devices.type, params.type as typeof devices.type.enumValues[number]));
    }

    if (params?.status) {
      conditions.push(eq(devices.status, params.status as 'ACTIVE' | 'INACTIVE' | 'DELETED'));
    }

    if (params?.connectivityStatus) {
      conditions.push(eq(devices.connectivityStatus, params.connectivityStatus as typeof devices.connectivityStatus.enumValues[number]));
    }

    const results = await db
      .select()
      .from(devices)
      .where(and(...conditions))
      .orderBy(devices.name)
      .limit(limit + 1)
      .offset(offset);

    const hasMore = results.length > limit;
    const items = hasMore ? results.slice(0, limit) : results;

    return {
      items: items.map(this.mapToEntity),
      pagination: {
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

    if (params?.type) {
      conditions.push(eq(devices.type, params.type as typeof devices.type.enumValues[number]));
    }

    if (params?.status) {
      conditions.push(eq(devices.status, params.status as 'ACTIVE' | 'INACTIVE' | 'DELETED'));
    }

    if (params?.connectivityStatus) {
      conditions.push(eq(devices.connectivityStatus, params.connectivityStatus as typeof devices.connectivityStatus.enumValues[number]));
    }

    const results = await db
      .select()
      .from(devices)
      .where(and(...conditions))
      .orderBy(devices.name)
      .limit(limit + 1)
      .offset(offset);

    const hasMore = results.length > limit;
    const items = hasMore ? results.slice(0, limit) : results;

    return {
      items: items.map(this.mapToEntity),
      pagination: {
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
      throw new AppError('DEVICE_NOT_FOUND', 'Device not found', 404);
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
      throw new AppError('DEVICE_NOT_FOUND', 'Device not found', 404);
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

  private mapToEntity(row: typeof devices.$inferSelect): Device {
    return {
      id: row.id,
      tenantId: row.tenantId,
      assetId: row.assetId,
      customerId: row.customerId,
      name: row.name,
      displayName: row.displayName,
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
    };
  }
}

// Export singleton instance
export const deviceRepository = new DeviceRepository();
