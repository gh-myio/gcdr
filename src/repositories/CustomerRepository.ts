import {
  GetCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
  QueryCommand,
  BatchGetCommand,
} from '@aws-sdk/lib-dynamodb';
import { Customer, createDefaultCustomerSettings } from '../domain/entities/Customer';
import { CreateCustomerDTO, UpdateCustomerDTO, ListCustomersParams } from '../dto/request/CustomerDTO';
import { PaginatedResult } from '../shared/types';
import { ICustomerRepository, CustomerTreeNode } from './interfaces/ICustomerRepository';
import { dynamoDb, TableNames } from '../infrastructure/database/dynamoClient';
import { generateId } from '../shared/utils/idGenerator';
import { now } from '../shared/utils/dateUtils';
import { AppError } from '../shared/errors/AppError';

export class CustomerRepository implements ICustomerRepository {
  private tableName = TableNames.CUSTOMERS;

  async create(tenantId: string, data: CreateCustomerDTO, createdBy: string): Promise<Customer> {
    const id = generateId();
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

    // Generate code if not provided
    const code = data.code || this.generateCode(data.name);

    const customer: Customer = {
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
      settings: data.settings ? { ...createDefaultCustomerSettings(), ...data.settings } : createDefaultCustomerSettings(),
      metadata: data.metadata || {},
      status: 'ACTIVE',
      version: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      createdBy,
    };

    await dynamoDb.send(
      new PutCommand({
        TableName: this.tableName,
        Item: customer,
        ConditionExpression: 'attribute_not_exists(id)',
      })
    );

    return customer;
  }

  async getById(tenantId: string, id: string): Promise<Customer | null> {
    const result = await dynamoDb.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { tenantId, id },
      })
    );

    return (result.Item as Customer) || null;
  }

  async getByCode(tenantId: string, code: string): Promise<Customer | null> {
    const result = await dynamoDb.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: 'gsi-code',
        KeyConditionExpression: 'tenantId = :tenantId AND code = :code',
        ExpressionAttributeValues: {
          ':tenantId': tenantId,
          ':code': code,
        },
        Limit: 1,
      })
    );

    if (!result.Items || result.Items.length === 0) {
      return null;
    }

    // GSI only has keys, need to fetch full item
    const item = result.Items[0] as { tenantId: string; id: string };
    return this.getById(item.tenantId, item.id);
  }

  async update(tenantId: string, id: string, data: UpdateCustomerDTO, updatedBy: string): Promise<Customer> {
    const existing = await this.getById(tenantId, id);
    if (!existing) {
      throw new AppError('CUSTOMER_NOT_FOUND', 'Customer not found', 404);
    }

    const updateExpressions: string[] = [];
    const expressionAttributeNames: Record<string, string> = {};
    const expressionAttributeValues: Record<string, unknown> = {};

    // Build dynamic update expression
    const fieldsToUpdate: Record<string, unknown> = {
      ...data,
      updatedAt: now(),
      updatedBy,
      version: existing.version + 1,
    };

    Object.entries(fieldsToUpdate).forEach(([key, value]) => {
      if (value !== undefined) {
        updateExpressions.push(`#${key} = :${key}`);
        expressionAttributeNames[`#${key}`] = key;
        expressionAttributeValues[`:${key}`] = value;
      }
    });

    expressionAttributeValues[':currentVersion'] = existing.version;

    const result = await dynamoDb.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { tenantId, id },
        UpdateExpression: `SET ${updateExpressions.join(', ')}`,
        ConditionExpression: '#version = :currentVersion',
        ExpressionAttributeNames: { ...expressionAttributeNames, '#version': 'version' },
        ExpressionAttributeValues: expressionAttributeValues,
        ReturnValues: 'ALL_NEW',
      })
    );

    return result.Attributes as Customer;
  }

  async delete(tenantId: string, id: string): Promise<void> {
    // Check for children first
    const children = await this.getChildren(tenantId, id);
    if (children.length > 0) {
      throw new AppError('HAS_CHILDREN', 'Cannot delete customer with children', 400);
    }

    await dynamoDb.send(
      new DeleteCommand({
        TableName: this.tableName,
        Key: { tenantId, id },
        ConditionExpression: 'attribute_exists(id)',
      })
    );
  }

  async list(tenantId: string, params?: { limit?: number; cursor?: string }): Promise<PaginatedResult<Customer>> {
    const limit = params?.limit || 20;

    const result = await dynamoDb.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'tenantId = :tenantId',
        ExpressionAttributeValues: {
          ':tenantId': tenantId,
        },
        Limit: limit + 1,
        ExclusiveStartKey: params?.cursor ? JSON.parse(Buffer.from(params.cursor, 'base64').toString()) : undefined,
      })
    );

    const items = (result.Items as Customer[]) || [];
    const hasMore = items.length > limit;
    const returnItems = hasMore ? items.slice(0, limit) : items;

    return {
      items: returnItems,
      pagination: {
        hasMore,
        nextCursor: hasMore && result.LastEvaluatedKey
          ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64')
          : undefined,
      },
    };
  }

  async listWithFilters(tenantId: string, params: ListCustomersParams): Promise<PaginatedResult<Customer>> {
    const limit = params.limit || 20;
    const filterExpressions: string[] = [];
    const expressionAttributeValues: Record<string, unknown> = { ':tenantId': tenantId };
    const expressionAttributeNames: Record<string, string> = {};

    // Add filters
    if (params.type) {
      filterExpressions.push('#type = :type');
      expressionAttributeNames['#type'] = 'type';
      expressionAttributeValues[':type'] = params.type;
    }

    if (params.status) {
      filterExpressions.push('#status = :status');
      expressionAttributeNames['#status'] = 'status';
      expressionAttributeValues[':status'] = params.status;
    }

    // Query by parent if specified
    let queryCommand: QueryCommand;

    if (params.parentCustomerId !== undefined) {
      queryCommand = new QueryCommand({
        TableName: this.tableName,
        IndexName: 'gsi-parent',
        KeyConditionExpression: 'tenantId = :tenantId AND parentCustomerId = :parentId',
        FilterExpression: filterExpressions.length > 0 ? filterExpressions.join(' AND ') : undefined,
        ExpressionAttributeNames: Object.keys(expressionAttributeNames).length > 0 ? expressionAttributeNames : undefined,
        ExpressionAttributeValues: {
          ...expressionAttributeValues,
          ':parentId': params.parentCustomerId,
        },
        Limit: limit + 1,
        ExclusiveStartKey: params.cursor ? JSON.parse(Buffer.from(params.cursor, 'base64').toString()) : undefined,
      });
    } else {
      queryCommand = new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'tenantId = :tenantId',
        FilterExpression: filterExpressions.length > 0 ? filterExpressions.join(' AND ') : undefined,
        ExpressionAttributeNames: Object.keys(expressionAttributeNames).length > 0 ? expressionAttributeNames : undefined,
        ExpressionAttributeValues: expressionAttributeValues,
        Limit: limit + 1,
        ExclusiveStartKey: params.cursor ? JSON.parse(Buffer.from(params.cursor, 'base64').toString()) : undefined,
      });
    }

    const result = await dynamoDb.send(queryCommand);
    const items = (result.Items as Customer[]) || [];
    const hasMore = items.length > limit;
    const returnItems = hasMore ? items.slice(0, limit) : items;

    return {
      items: returnItems,
      pagination: {
        hasMore,
        nextCursor: hasMore && result.LastEvaluatedKey
          ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64')
          : undefined,
      },
    };
  }

  async getChildren(tenantId: string, parentCustomerId: string | null): Promise<Customer[]> {
    // For null parent, we need to query root customers
    if (parentCustomerId === null) {
      const result = await dynamoDb.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: 'tenantId = :tenantId',
          FilterExpression: 'attribute_not_exists(parentCustomerId) OR parentCustomerId = :null',
          ExpressionAttributeValues: {
            ':tenantId': tenantId,
            ':null': null,
          },
        })
      );
      return (result.Items as Customer[]) || [];
    }

    const result = await dynamoDb.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: 'gsi-parent',
        KeyConditionExpression: 'tenantId = :tenantId AND parentCustomerId = :parentId',
        ExpressionAttributeValues: {
          ':tenantId': tenantId,
          ':parentId': parentCustomerId,
        },
      })
    );

    return (result.Items as Customer[]) || [];
  }

  async getDescendants(tenantId: string, customerId: string, maxDepth?: number): Promise<Customer[]> {
    const customer = await this.getById(tenantId, customerId);
    if (!customer) {
      throw new AppError('CUSTOMER_NOT_FOUND', 'Customer not found', 404);
    }

    // Query by path prefix
    const result = await dynamoDb.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: 'gsi-path',
        KeyConditionExpression: 'tenantId = :tenantId AND begins_with(#path, :pathPrefix)',
        ExpressionAttributeNames: {
          '#path': 'path',
        },
        ExpressionAttributeValues: {
          ':tenantId': tenantId,
          ':pathPrefix': `${customer.path}/`,
        },
      })
    );

    let descendants = (result.Items as Customer[]) || [];

    // Filter by maxDepth if specified
    if (maxDepth !== undefined) {
      const maxAllowedDepth = customer.depth + maxDepth;
      descendants = descendants.filter((d) => d.depth <= maxAllowedDepth);
    }

    return descendants;
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

    // Batch get ancestors
    const keys = ancestorIds.map((id) => ({ tenantId, id }));
    const result = await dynamoDb.send(
      new BatchGetCommand({
        RequestItems: {
          [this.tableName]: {
            Keys: keys,
          },
        },
      })
    );

    const ancestors = (result.Responses?.[this.tableName] as Customer[]) || [];

    // Sort by depth (root first)
    return ancestors.sort((a, b) => a.depth - b.depth);
  }

  async getTree(tenantId: string, rootCustomerId?: string): Promise<CustomerTreeNode[]> {
    let customers: Customer[];

    if (rootCustomerId) {
      const root = await this.getById(tenantId, rootCustomerId);
      if (!root) {
        throw new AppError('CUSTOMER_NOT_FOUND', 'Root customer not found', 404);
      }
      const descendants = await this.getDescendants(tenantId, rootCustomerId);
      customers = [root, ...descendants];
    } else {
      const result = await this.list(tenantId, { limit: 1000 });
      customers = result.items;
    }

    return this.buildTree(customers, rootCustomerId || null);
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

    // Update customer
    const updatedCustomer = await this.update(
      tenantId,
      customerId,
      {
        // path and depth are not in UpdateCustomerDTO, handled separately
      } as UpdateCustomerDTO,
      updatedBy
    );

    // Update path and depth directly
    await this.updatePath(tenantId, customerId, newPath, newDepth);

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
    await dynamoDb.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { tenantId, id: customerId },
        UpdateExpression: 'SET #path = :path, #depth = :depth, updatedAt = :updatedAt',
        ExpressionAttributeNames: {
          '#path': 'path',
          '#depth': 'depth',
        },
        ExpressionAttributeValues: {
          ':path': newPath,
          ':depth': newDepth,
          ':updatedAt': now(),
        },
      })
    );
  }

  private buildTree(customers: Customer[], rootParentId: string | null): CustomerTreeNode[] {
    const customerMap = new Map<string, CustomerTreeNode>();
    const roots: CustomerTreeNode[] = [];

    // Initialize all nodes
    customers.forEach((customer) => {
      customerMap.set(customer.id, { ...customer, children: [] });
    });

    // Build tree structure
    customers.forEach((customer) => {
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

  private generateCode(name: string): string {
    return name
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '-')
      .replace(/-+/g, '-')
      .substring(0, 20);
  }
}
