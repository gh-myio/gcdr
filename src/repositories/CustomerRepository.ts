import { eq, and, like, isNull, sql, inArray, notInArray } from 'drizzle-orm';
import { db, schema } from '../infrastructure/database/drizzle/db';
import { Customer, createDefaultCustomerSettings, generateCustomerCode } from '../domain/entities/Customer';
import { CreateCustomerDTO, UpdateCustomerDTO, ListCustomersParams } from '../dto/request/CustomerDTO';
import { PaginatedResult } from '../shared/types';
import { ICustomerRepository, CustomerTreeNode, ForceDeleteResult } from './interfaces/ICustomerRepository';
import { generateId } from '../shared/utils/idGenerator';
import { now } from '../shared/utils/dateUtils';
import { AppError } from '../shared/errors/AppError';
import { countWhere } from './helpers/countQuery';

const { customers } = schema;

export class CustomerRepository implements ICustomerRepository {

  async create(tenantId: string, data: CreateCustomerDTO, createdBy: string): Promise<Customer> {
    const id = data.id || generateId();
    const timestamp = now();

    // Calculate path and depth based on parent
    let path: string;
    let depth: number;

    if (data.parentCustomerId) {
      const parent = await this.getById(tenantId, data.parentCustomerId);
      if (!parent) {
        throw new AppError('PARENT_NOT_FOUND', 'Parent customer not found', 404);
      }
      path = `${parent.path}/${id}`;
      depth = parent.depth + 1;
    } else {
      path = `/${tenantId}/${id}`;
      depth = 0;
    }

    // Generate code if not provided (CustomerService normally resolves it upfront)
    const code = data.code || generateCustomerCode(data.name);

    const [result] = await db.insert(customers).values({
      id,
      tenantId,
      parentCustomerId: data.parentCustomerId || null,
      path,
      depth,
      name: data.name,
      displayName: data.displayName || data.name,
      code,
      type: data.type,
      email: data.email,
      phone: data.phone,
      address: data.address,
      externalId: data.externalId || null,
      settings: data.settings ? { ...createDefaultCustomerSettings(), ...data.settings } : createDefaultCustomerSettings(),
      metadata: data.metadata || {},
      status: 'ACTIVE',
      version: 1,
      createdAt: new Date(timestamp),
      updatedAt: new Date(timestamp),
      createdBy,
    }).returning();

    return this.mapToEntity(result);
  }

  async getById(tenantId: string, id: string): Promise<Customer | null> {
    const [result] = await db
      .select()
      .from(customers)
      .where(and(eq(customers.tenantId, tenantId), eq(customers.id, id)))
      .limit(1);

    return result ? this.mapToEntity(result) : null;
  }

  async getByCode(tenantId: string, code: string): Promise<Customer | null> {
    const [result] = await db
      .select()
      .from(customers)
      .where(and(eq(customers.tenantId, tenantId), eq(customers.code, code)))
      .limit(1);

    return result ? this.mapToEntity(result) : null;
  }

  async getByExternalId(tenantId: string, externalId: string): Promise<Customer | null> {
    const [result] = await db
      .select()
      .from(customers)
      .where(and(eq(customers.tenantId, tenantId), eq(customers.externalId, externalId)))
      .limit(1);

    return result ? this.mapToEntity(result) : null;
  }

  async update(tenantId: string, id: string, data: UpdateCustomerDTO, updatedBy: string): Promise<Customer> {
    const existing = await this.getById(tenantId, id);
    if (!existing) {
      throw new AppError('CUSTOMER_NOT_FOUND', 'Customer not found', 404);
    }

    const updateData: Record<string, unknown> = {
      updatedAt: new Date(),
      updatedBy,
      version: existing.version + 1,
    };

    // Only update fields that are provided
    if (data.name !== undefined) updateData.name = data.name;
    if (data.displayName !== undefined) updateData.displayName = data.displayName;
    if (data.code !== undefined) updateData.code = data.code;
    if (data.type !== undefined) updateData.type = data.type;
    if (data.email !== undefined) updateData.email = data.email;
    if (data.phone !== undefined) updateData.phone = data.phone;
    if (data.address !== undefined) updateData.address = data.address;
    if (data.externalId !== undefined) updateData.externalId = data.externalId;
    if (data.settings !== undefined) updateData.settings = { ...existing.settings, ...data.settings };
    if (data.theme !== undefined) updateData.theme = data.theme;
    if (data.metadata !== undefined) updateData.metadata = { ...existing.metadata, ...data.metadata };
    if (data.config !== undefined) updateData.config = data.config ?? null;
    if (data.status !== undefined) updateData.status = data.status;

    const [result] = await db
      .update(customers)
      .set(updateData)
      .where(and(
        eq(customers.tenantId, tenantId),
        eq(customers.id, id),
        eq(customers.version, existing.version) // Optimistic locking
      ))
      .returning();

    if (!result) {
      throw new AppError('CONCURRENT_UPDATE', 'Customer was modified by another process', 409);
    }

    return this.mapToEntity(result);
  }

  async delete(tenantId: string, id: string): Promise<void> {
    // Check for children first
    const children = await this.getChildren(tenantId, id);
    if (children.length > 0) {
      throw new AppError('HAS_CHILDREN', 'Cannot delete customer with children', 400);
    }

    const result = await db
      .delete(customers)
      .where(and(eq(customers.tenantId, tenantId), eq(customers.id, id)));

    // Drizzle doesn't return affected rows directly, so we trust it worked
  }

  async forceDelete(tenantId: string, customerId: string, options: import('./interfaces/ICustomerRepository').ForceDeleteOptions = {}): Promise<ForceDeleteResult> {
    const customer = await this.getById(tenantId, customerId);
    if (!customer) {
      throw new AppError('CUSTOMER_NOT_FOUND', 'Customer not found', 404);
    }

    const descendants = await this.getDescendants(tenantId, customerId);
    const allCustomerIds = [customerId, ...descendants.map((d) => d.id)];

    const summary: ForceDeleteResult['summary'] = {
      users: 0,
      assets: 0,
      devices: 0,
      rules: 0,
      centrals: 0,
      groups: 0,
      lookAndFeels: 0,
      customerApiKeys: 0,
      maintenanceGroups: 0,
      alarmBundleVersions: 0,
    };

    await db.transaction(async (trx) => {
      // Collect user IDs for these customers (needed before user deletion)
      const affectedUsers = await trx
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(and(
          eq(schema.users.tenantId, tenantId),
          inArray(schema.users.customerId, allCustomerIds),
        ));
      const userIds = affectedUsers.map((u) => u.id);

      // Delete roleAssignments for these users (FK → users.id, no cascade)
      if (userIds.length > 0) {
        await trx.delete(schema.roleAssignments)
          .where(and(
            eq(schema.roleAssignments.tenantId, tenantId),
            inArray(schema.roleAssignments.userId, userIds),
          ));
      }

      // Delete alarmBundleVersions (no FK constraint on customer_id)
      const deletedABV = await trx.delete(schema.alarmBundleVersions)
        .where(and(
          eq(schema.alarmBundleVersions.tenantId, tenantId),
          inArray(schema.alarmBundleVersions.customerId, allCustomerIds),
        ))
        .returning({ id: schema.alarmBundleVersions.id });
      summary.alarmBundleVersions = deletedABV.length;

      // Delete customerApiKeys (FK → customers.id) — skipped if keepApiKeys=true
      if (!options.keepApiKeys) {
        const deletedKeys = await trx.delete(schema.customerApiKeys)
          .where(and(
            eq(schema.customerApiKeys.tenantId, tenantId),
            inArray(schema.customerApiKeys.customerId, allCustomerIds),
          ))
          .returning({ id: schema.customerApiKeys.id });
        summary.customerApiKeys = deletedKeys.length;
      }

      // Delete rules (FK → customers.id) — skipped if keepRules=true
      if (!options.keepRules) {
        const deletedRules = await trx.delete(schema.rules)
          .where(and(
            eq(schema.rules.tenantId, tenantId),
            inArray(schema.rules.customerId, allCustomerIds),
          ))
          .returning({ id: schema.rules.id });
        summary.rules = deletedRules.length;
      }

      // Delete groups (FK → customers.id)
      const deletedGroups = await trx.delete(schema.groups)
        .where(and(
          eq(schema.groups.tenantId, tenantId),
          inArray(schema.groups.customerId, allCustomerIds),
        ))
        .returning({ id: schema.groups.id });
      summary.groups = deletedGroups.length;

      // Delete lookAndFeels (FK → customers.id)
      const deletedLAF = await trx.delete(schema.lookAndFeels)
        .where(and(
          eq(schema.lookAndFeels.tenantId, tenantId),
          inArray(schema.lookAndFeels.customerId, allCustomerIds),
        ))
        .returning({ id: schema.lookAndFeels.id });
      summary.lookAndFeels = deletedLAF.length;

      // Delete maintenanceGroups (FK → customers.id, cascade → userMaintenanceGroups)
      const deletedMG = await trx.delete(schema.maintenanceGroups)
        .where(and(
          eq(schema.maintenanceGroups.tenantId, tenantId),
          inArray(schema.maintenanceGroups.customerId, allCustomerIds),
        ))
        .returning({ id: schema.maintenanceGroups.id });
      summary.maintenanceGroups = deletedMG.length;

      // Delete centrals BEFORE assets (FK → customers.id AND assets.id) — skipped if keepCentrals=true
      if (!options.keepCentrals) {
        const deletedCentrals = await trx.delete(schema.centrals)
          .where(and(
            eq(schema.centrals.tenantId, tenantId),
            inArray(schema.centrals.customerId, allCustomerIds),
          ))
          .returning({ id: schema.centrals.id });
        summary.centrals = deletedCentrals.length;
      }

      // Collect all asset IDs for these customers (needed before device deletion to catch
      // devices that may reference these assets but have an inconsistent customerId)
      const customerAssets = await trx
        .select({ id: schema.assets.id })
        .from(schema.assets)
        .where(and(
          eq(schema.assets.tenantId, tenantId),
          inArray(schema.assets.customerId, allCustomerIds),
        ));
      const allAssetIds = customerAssets.map((a) => a.id);

      // Delete devices BEFORE assets (FK → customers.id AND assets.id)
      // First pass: by customerId (normal case)
      const deletedDevices = await trx.delete(schema.devices)
        .where(and(
          eq(schema.devices.tenantId, tenantId),
          inArray(schema.devices.customerId, allCustomerIds),
        ))
        .returning({ id: schema.devices.id });
      summary.devices = deletedDevices.length;

      // Second pass: catch any stray devices referencing customer assets with a different customerId
      if (allAssetIds.length > 0) {
        const strayDevices = await trx.delete(schema.devices)
          .where(and(
            eq(schema.devices.tenantId, tenantId),
            inArray(schema.devices.assetId, allAssetIds),
          ))
          .returning({ id: schema.devices.id, customerId: schema.devices.customerId, assetId: schema.devices.assetId });
        if (strayDevices.length > 0) {
          console.warn(
            `[forceDelete] DATA_INCONSISTENCY: ${strayDevices.length} device(s) had assetId pointing to customer ${customerId} but a different customerId. Deleted:`,
            strayDevices.map((d) => ({ deviceId: d.id, deviceCustomerId: d.customerId, assetId: d.assetId })),
          );
        }
        summary.devices += strayDevices.length;
      }

      // Delete assets (FK → customers.id)
      // When keepCentrals=true, exclude assets still referenced by centrals (FK constraint)
      const centralAssetIds = options.keepCentrals
        ? (await trx
            .select({ assetId: schema.centrals.assetId })
            .from(schema.centrals)
            .where(and(
              eq(schema.centrals.tenantId, tenantId),
              inArray(schema.centrals.customerId, allCustomerIds),
            ))
          ).map((r) => r.assetId)
        : [];

      const assetWhere = centralAssetIds.length > 0
        ? and(
            eq(schema.assets.tenantId, tenantId),
            inArray(schema.assets.customerId, allCustomerIds),
            notInArray(schema.assets.id, centralAssetIds),
          )
        : and(
            eq(schema.assets.tenantId, tenantId),
            inArray(schema.assets.customerId, allCustomerIds),
          );

      const deletedAssets = await trx.delete(schema.assets)
        .where(assetWhere)
        .returning({ id: schema.assets.id });
      summary.assets = deletedAssets.length;

      // Delete users (FK → customers.id is optional; roleAssignments already deleted above)
      if (userIds.length > 0) {
        const deletedUsers = await trx.delete(schema.users)
          .where(and(
            eq(schema.users.tenantId, tenantId),
            inArray(schema.users.id, userIds),
          ))
          .returning({ id: schema.users.id });
        summary.users = deletedUsers.length;
      }

      // Delete customers — skipped when any "keep" option is active:
      //   keepCentrals: centrals → assets → customers (unbreakable FK chain)
      //   keepApiKeys:  customer_api_keys.customer_id → customers (FK)
      // When skipped this becomes a "data reset": devices/rules/users/groups wiped
      // but the customer record itself is preserved.
      const keepCustomer = options.keepCentrals || options.keepApiKeys || options.keepRules;
      if (!keepCustomer) {
        await trx.delete(customers)
          .where(and(
            eq(customers.tenantId, tenantId),
            inArray(customers.id, allCustomerIds),
          ));
      }
    });

    return {
      deletedCustomers: (options.keepCentrals || options.keepApiKeys || options.keepRules) ? 0 : allCustomerIds.length,
      summary,
    };
  }

  async list(tenantId: string, params?: { limit?: number; cursor?: string }): Promise<PaginatedResult<Customer>> {
    const limit = params?.limit || 20;
    const offset = params?.cursor ? parseInt(params.cursor, 10) : 0;

    const conditions = [eq(customers.tenantId, tenantId)];

    const [results, total] = await Promise.all([
      db.select()
        .from(customers)
        .where(and(...conditions))
        .orderBy(customers.createdAt)
        .limit(limit + 1)
        .offset(offset),
      countWhere(customers, conditions),
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

  async listWithFilters(tenantId: string, params: ListCustomersParams): Promise<PaginatedResult<Customer>> {
    const limit = params.limit || 20;
    const offset = params.cursor ? parseInt(params.cursor, 10) : 0;

    // Build conditions
    const conditions = [eq(customers.tenantId, tenantId)];

    if (params.type) {
      conditions.push(eq(customers.type, params.type));
    }

    if (params.status) {
      conditions.push(eq(customers.status, params.status));
    }

    if (params.parentCustomerId !== undefined) {
      if (params.parentCustomerId === null) {
        conditions.push(isNull(customers.parentCustomerId));
      } else {
        conditions.push(eq(customers.parentCustomerId, params.parentCustomerId));
      }
    }

    if (params.search) {
      conditions.push(sql`(${customers.name} ILIKE ${`%${params.search}%`} OR ${customers.displayName} ILIKE ${`%${params.search}%`})`);
    }

    const [results, total] = await Promise.all([
      db.select()
        .from(customers)
        .where(and(...conditions))
        .orderBy(customers.name)
        .limit(limit + 1)
        .offset(offset),
      countWhere(customers, conditions),
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

  async getChildren(tenantId: string, parentCustomerId: string | null): Promise<Customer[]> {
    let results;

    if (parentCustomerId === null) {
      results = await db
        .select()
        .from(customers)
        .where(and(
          eq(customers.tenantId, tenantId),
          isNull(customers.parentCustomerId)
        ))
        .orderBy(customers.name);
    } else {
      results = await db
        .select()
        .from(customers)
        .where(and(
          eq(customers.tenantId, tenantId),
          eq(customers.parentCustomerId, parentCustomerId)
        ))
        .orderBy(customers.name);
    }

    return results.map(this.mapToEntity);
  }

  async getDescendants(tenantId: string, customerId: string, maxDepth?: number): Promise<Customer[]> {
    const customer = await this.getById(tenantId, customerId);
    if (!customer) {
      throw new AppError('CUSTOMER_NOT_FOUND', 'Customer not found', 404);
    }

    // Query by path prefix using LIKE
    const pathPrefix = `${customer.path}/%`;

    let results = await db
      .select()
      .from(customers)
      .where(and(
        eq(customers.tenantId, tenantId),
        like(customers.path, pathPrefix)
      ))
      .orderBy(customers.depth, customers.name);

    // Filter by maxDepth if specified
    if (maxDepth !== undefined) {
      const maxAllowedDepth = customer.depth + maxDepth;
      results = results.filter((c) => c.depth <= maxAllowedDepth);
    }

    return results.map(this.mapToEntity);
  }

  async getAncestors(tenantId: string, customerId: string): Promise<Customer[]> {
    const customer = await this.getById(tenantId, customerId);
    if (!customer) {
      throw new AppError('CUSTOMER_NOT_FOUND', 'Customer not found', 404);
    }

    // Parse path to get ancestor IDs
    const pathParts = customer.path.split('/').filter(Boolean);
    // Remove tenant and self from path
    const ancestorIds = pathParts.slice(1, -1);

    if (ancestorIds.length === 0) {
      return [];
    }

    // Fetch ancestors
    const results = await db
      .select()
      .from(customers)
      .where(and(
        eq(customers.tenantId, tenantId),
        inArray(customers.id, ancestorIds)
      ))
      .orderBy(customers.depth);

    return results.map(this.mapToEntity);
  }

  async getTree(tenantId: string, rootCustomerId?: string): Promise<CustomerTreeNode[]> {
    let customerList: Customer[];

    if (rootCustomerId) {
      const root = await this.getById(tenantId, rootCustomerId);
      if (!root) {
        throw new AppError('CUSTOMER_NOT_FOUND', 'Root customer not found', 404);
      }
      const descendants = await this.getDescendants(tenantId, rootCustomerId);
      customerList = [root, ...descendants];
    } else {
      const result = await this.list(tenantId, { limit: 1000 });
      customerList = result.items;
    }

    return this.buildTree(customerList, rootCustomerId || null);
  }

  async move(tenantId: string, customerId: string, newParentId: string | null, updatedBy: string): Promise<Customer> {
    const customer = await this.getById(tenantId, customerId);
    if (!customer) {
      throw new AppError('CUSTOMER_NOT_FOUND', 'Customer not found', 404);
    }

    // Validate new parent
    let newPath: string;
    let newDepth: number;

    if (newParentId) {
      const newParent = await this.getById(tenantId, newParentId);
      if (!newParent) {
        throw new AppError('PARENT_NOT_FOUND', 'New parent customer not found', 404);
      }

      // Check for circular reference
      if (newParent.path.startsWith(customer.path)) {
        throw new AppError('CIRCULAR_REFERENCE', 'Cannot move customer under its own descendant', 400);
      }

      newPath = `${newParent.path}/${customerId}`;
      newDepth = newParent.depth + 1;
    } else {
      newPath = `/${tenantId}/${customerId}`;
      newDepth = 0;
    }

    const oldPath = customer.path;

    // Update customer path
    await this.updatePath(tenantId, customerId, newPath, newDepth);

    // Update parent reference
    await db
      .update(customers)
      .set({
        parentCustomerId: newParentId,
        updatedAt: new Date(),
        updatedBy,
      })
      .where(and(eq(customers.tenantId, tenantId), eq(customers.id, customerId)));

    // Update all descendants' paths
    const descendants = await this.getDescendants(tenantId, customerId);
    for (const descendant of descendants) {
      const descendantNewPath = descendant.path.replace(oldPath, newPath);
      const depthDiff = newDepth - customer.depth;
      await this.updatePath(tenantId, descendant.id, descendantNewPath, descendant.depth + depthDiff);
    }

    // Fetch updated customer
    return (await this.getById(tenantId, customerId))!;
  }

  async updatePath(tenantId: string, customerId: string, newPath: string, newDepth: number): Promise<void> {
    await db
      .update(customers)
      .set({
        path: newPath,
        depth: newDepth,
        updatedAt: new Date(),
      })
      .where(and(eq(customers.tenantId, tenantId), eq(customers.id, customerId)));
  }

  private buildTree(customerList: Customer[], rootParentId: string | null): CustomerTreeNode[] {
    const customerMap = new Map<string, CustomerTreeNode>();
    const roots: CustomerTreeNode[] = [];

    // Initialize all nodes
    customerList.forEach((customer) => {
      customerMap.set(customer.id, { ...customer, children: [] });
    });

    // Build tree structure
    customerList.forEach((customer) => {
      const node = customerMap.get(customer.id)!;
      if (customer.parentCustomerId === rootParentId) {
        roots.push(node);
      } else if (customer.parentCustomerId && customerMap.has(customer.parentCustomerId)) {
        customerMap.get(customer.parentCustomerId)!.children.push(node);
      }
    });

    // Sort children by name
    const sortChildren = (nodes: CustomerTreeNode[]) => {
      nodes.sort((a, b) => a.name.localeCompare(b.name));
      nodes.forEach((node) => sortChildren(node.children));
    };
    sortChildren(roots);

    return roots;
  }

  // RFC-0032: list QR-enabled customers the user has access to via
  // any active role assignment whose scope is `customer:<uuid>`.
  // Inner join on wo_customer_settings filters to QR-enabled only.
  async listWoEnabledForUser(tenantId: string, userId: string): Promise<Customer[]> {
    const { woCustomerSettings, roleAssignments } = schema;

    const rows = await db
      .select({ c: customers })
      .from(customers)
      .innerJoin(
        woCustomerSettings,
        eq(woCustomerSettings.customerId, customers.id),
      )
      .innerJoin(
        roleAssignments,
        and(
          eq(roleAssignments.tenantId, customers.tenantId),
          eq(roleAssignments.userId, userId),
          eq(roleAssignments.status, 'active'),
          eq(roleAssignments.scope, sql`'customer:' || ${customers.id}::text`),
        ),
      )
      .where(and(
        eq(customers.tenantId, tenantId),
        isNull(customers.deletedAt),
      ))
      .orderBy(customers.name);

    const seen = new Set<string>();
    const out: Customer[] = [];
    for (const r of rows) {
      if (seen.has(r.c.id)) continue;
      seen.add(r.c.id);
      out.push(this.mapToEntity(r.c));
    }
    return out;
  }

  private mapToEntity(row: typeof customers.$inferSelect): Customer {
    return {
      id: row.id,
      tenantId: row.tenantId,
      parentCustomerId: row.parentCustomerId,
      path: row.path,
      depth: row.depth,
      externalId: row.externalId || undefined,
      name: row.name,
      displayName: row.displayName,
      code: row.code,
      type: row.type,
      email: row.email || undefined,
      phone: row.phone || undefined,
      address: row.address as Customer['address'],
      settings: row.settings as Customer['settings'],
      theme: row.theme as Customer['theme'],
      metadata: row.metadata as Record<string, unknown>,
      config: (row.config as Customer['config']) ?? undefined,
      status: row.status,
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
export const customerRepository = new CustomerRepository();
