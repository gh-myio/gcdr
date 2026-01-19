import { GetCommand, PutCommand, UpdateCommand, DeleteCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import {
  LookAndFeel,
  createDefaultColorPalette,
  createDefaultTypography,
  createDefaultLayoutConfig,
  createDefaultComponentStyles,
} from '../domain/entities/LookAndFeel';
import { CreateLookAndFeelDTO, UpdateLookAndFeelDTO } from '../dto/request/LookAndFeelDTO';
import { PaginatedResult } from '../shared/types';
import { ILookAndFeelRepository } from './interfaces/ILookAndFeelRepository';
import { dynamoDb, TableNames } from '../infrastructure/database/dynamoClient';
import { generateId } from '../shared/utils/idGenerator';
import { now } from '../shared/utils/dateUtils';
import { AppError } from '../shared/errors/AppError';

export class LookAndFeelRepository implements ILookAndFeelRepository {
  private tableName = TableNames.THEMES;

  async create(tenantId: string, data: CreateLookAndFeelDTO, createdBy: string): Promise<LookAndFeel> {
    const id = generateId();
    const timestamp = now();

    const theme: LookAndFeel = {
      id,
      tenantId,
      customerId: data.customerId,
      name: data.name,
      description: data.description,
      isDefault: data.isDefault,
      mode: data.mode,
      colors: data.colors,
      darkModeColors: data.darkModeColors,
      typography: data.typography || createDefaultTypography(),
      logo: data.logo,
      brandName: data.brandName,
      tagline: data.tagline,
      layout: data.layout || createDefaultLayoutConfig(),
      components: data.components || createDefaultComponentStyles(),
      customCss: data.customCss,
      inheritFromParent: data.inheritFromParent,
      parentThemeId: data.parentThemeId,
      metadata: data.metadata || {},
      version: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      createdBy,
    };

    await dynamoDb.send(
      new PutCommand({
        TableName: this.tableName,
        Item: theme,
        ConditionExpression: 'attribute_not_exists(id)',
      })
    );

    // If this is set as default, unset other defaults for this customer
    if (data.isDefault) {
      await this.unsetOtherDefaults(tenantId, data.customerId, id);
    }

    return theme;
  }

  async getById(tenantId: string, id: string): Promise<LookAndFeel | null> {
    const result = await dynamoDb.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { tenantId, id },
      })
    );

    return (result.Item as LookAndFeel) || null;
  }

  async update(tenantId: string, id: string, data: UpdateLookAndFeelDTO, updatedBy: string): Promise<LookAndFeel> {
    const existing = await this.getById(tenantId, id);
    if (!existing) {
      throw new AppError('THEME_NOT_FOUND', 'Theme not found', 404);
    }

    const updateExpressions: string[] = [];
    const expressionAttributeNames: Record<string, string> = {};
    const expressionAttributeValues: Record<string, unknown> = {};

    const fieldsToUpdate: Record<string, unknown> = {
      ...data,
      updatedAt: now(),
      updatedBy,
      version: existing.version + 1,
    };

    // Deep merge colors if provided
    if (data.colors) {
      fieldsToUpdate.colors = { ...existing.colors, ...data.colors };
    }

    // Deep merge other nested objects
    if (data.typography) {
      fieldsToUpdate.typography = { ...existing.typography, ...data.typography };
    }

    if (data.layout) {
      fieldsToUpdate.layout = { ...existing.layout, ...data.layout };
    }

    if (data.components) {
      fieldsToUpdate.components = { ...existing.components, ...data.components };
    }

    if (data.logo) {
      fieldsToUpdate.logo = { ...existing.logo, ...data.logo };
    }

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

    // If this is set as default, unset other defaults
    if (data.isDefault === true) {
      await this.unsetOtherDefaults(tenantId, existing.customerId, id);
    }

    return result.Attributes as LookAndFeel;
  }

  async delete(tenantId: string, id: string): Promise<void> {
    const existing = await this.getById(tenantId, id);
    if (existing && existing.isDefault) {
      throw new AppError('CANNOT_DELETE_DEFAULT', 'Cannot delete the default theme. Set another theme as default first.', 400);
    }

    await dynamoDb.send(
      new DeleteCommand({
        TableName: this.tableName,
        Key: { tenantId, id },
        ConditionExpression: 'attribute_exists(id)',
      })
    );
  }

  async list(tenantId: string, params?: { limit?: number; cursor?: string }): Promise<PaginatedResult<LookAndFeel>> {
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

    const items = (result.Items as LookAndFeel[]) || [];
    const hasMore = items.length > limit;
    const returnItems = hasMore ? items.slice(0, limit) : items;

    return {
      items: returnItems,
      pagination: {
        hasMore,
        nextCursor:
          hasMore && result.LastEvaluatedKey
            ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64')
            : undefined,
      },
    };
  }

  async listByCustomer(tenantId: string, customerId: string): Promise<LookAndFeel[]> {
    const result = await dynamoDb.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: 'gsi-customer',
        KeyConditionExpression: 'tenantId = :tenantId AND customerId = :customerId',
        ExpressionAttributeValues: {
          ':tenantId': tenantId,
          ':customerId': customerId,
        },
      })
    );

    return (result.Items as LookAndFeel[]) || [];
  }

  async getDefaultByCustomer(tenantId: string, customerId: string): Promise<LookAndFeel | null> {
    const result = await dynamoDb.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: 'gsi-customer',
        KeyConditionExpression: 'tenantId = :tenantId AND customerId = :customerId',
        FilterExpression: 'isDefault = :isDefault',
        ExpressionAttributeValues: {
          ':tenantId': tenantId,
          ':customerId': customerId,
          ':isDefault': true,
        },
        Limit: 1,
      })
    );

    return result.Items && result.Items.length > 0 ? (result.Items[0] as LookAndFeel) : null;
  }

  async setDefault(tenantId: string, customerId: string, themeId: string): Promise<LookAndFeel> {
    // First, unset all other defaults for this customer
    await this.unsetOtherDefaults(tenantId, customerId, themeId);

    // Then set the new default
    const result = await dynamoDb.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { tenantId, id: themeId },
        UpdateExpression: 'SET isDefault = :isDefault, updatedAt = :updatedAt',
        ExpressionAttributeValues: {
          ':isDefault': true,
          ':updatedAt': now(),
        },
        ReturnValues: 'ALL_NEW',
      })
    );

    return result.Attributes as LookAndFeel;
  }

  async getByParentTheme(tenantId: string, parentThemeId: string): Promise<LookAndFeel[]> {
    const result = await dynamoDb.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'tenantId = :tenantId',
        FilterExpression: 'parentThemeId = :parentThemeId',
        ExpressionAttributeValues: {
          ':tenantId': tenantId,
          ':parentThemeId': parentThemeId,
        },
      })
    );

    return (result.Items as LookAndFeel[]) || [];
  }

  private async unsetOtherDefaults(tenantId: string, customerId: string, exceptThemeId: string): Promise<void> {
    const customerThemes = await this.listByCustomer(tenantId, customerId);

    for (const theme of customerThemes) {
      if (theme.id !== exceptThemeId && theme.isDefault) {
        await dynamoDb.send(
          new UpdateCommand({
            TableName: this.tableName,
            Key: { tenantId, id: theme.id },
            UpdateExpression: 'SET isDefault = :isDefault, updatedAt = :updatedAt',
            ExpressionAttributeValues: {
              ':isDefault': false,
              ':updatedAt': now(),
            },
          })
        );
      }
    }
  }
}
