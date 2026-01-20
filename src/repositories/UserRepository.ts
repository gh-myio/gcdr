import { GetCommand, PutCommand, UpdateCommand, DeleteCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import {
  User,
  UserStatus,
  createDefaultPreferences,
  createDefaultSecurity,
  createDefaultProfile,
} from '../domain/entities/User';
import { CreateUserDTO, UpdateUserDTO, ListUsersDTO } from '../dto/request/UserDTO';
import { PaginatedResult } from '../shared/types';
import { IUserRepository } from './interfaces/IUserRepository';
import { dynamoDb, TableNames } from '../infrastructure/database/dynamoClient';
import { generateId } from '../shared/utils/idGenerator';
import { now } from '../shared/utils/dateUtils';
import { AppError } from '../shared/errors/AppError';

export class UserRepository implements IUserRepository {
  private tableName = TableNames.USERS;

  async create(tenantId: string, data: CreateUserDTO, createdBy: string): Promise<User> {
    const id = generateId();
    const timestamp = now();

    const user: User = {
      id,
      tenantId,
      customerId: data.customerId,
      partnerId: data.partnerId,
      email: data.email.toLowerCase(),
      emailVerified: false,
      username: data.username,
      type: data.type,
      status: 'PENDING_VERIFICATION',
      profile: data.profile
        ? { ...createDefaultProfile(data.profile.firstName, data.profile.lastName), ...data.profile }
        : createDefaultProfile('', ''),
      security: createDefaultSecurity(),
      preferences: data.preferences
        ? { ...createDefaultPreferences(), ...data.preferences }
        : createDefaultPreferences(),
      activeSessions: 0,
      invitedBy: createdBy,
      invitedAt: timestamp,
      tags: data.tags || [],
      metadata: data.metadata || {},
      version: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      createdBy,
    };

    await dynamoDb.send(
      new PutCommand({
        TableName: this.tableName,
        Item: user,
        ConditionExpression: 'attribute_not_exists(id)',
      })
    );

    return user;
  }

  async getById(tenantId: string, id: string): Promise<User | null> {
    const result = await dynamoDb.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { tenantId, id },
      })
    );

    return (result.Item as User) || null;
  }

  async getByEmail(tenantId: string, email: string): Promise<User | null> {
    const result = await dynamoDb.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: 'gsi-email',
        KeyConditionExpression: 'tenantId = :tenantId AND email = :email',
        ExpressionAttributeValues: {
          ':tenantId': tenantId,
          ':email': email.toLowerCase(),
        },
        Limit: 1,
      })
    );

    return result.Items && result.Items.length > 0 ? (result.Items[0] as User) : null;
  }

  async getByUsername(tenantId: string, username: string): Promise<User | null> {
    const result = await dynamoDb.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: 'gsi-username',
        KeyConditionExpression: 'tenantId = :tenantId AND username = :username',
        ExpressionAttributeValues: {
          ':tenantId': tenantId,
          ':username': username,
        },
        Limit: 1,
      })
    );

    return result.Items && result.Items.length > 0 ? (result.Items[0] as User) : null;
  }

  async update(tenantId: string, id: string, data: UpdateUserDTO, updatedBy: string): Promise<User> {
    const existing = await this.getById(tenantId, id);
    if (!existing) {
      throw new AppError('USER_NOT_FOUND', 'User not found', 404);
    }

    const updateExpressions: string[] = [];
    const expressionAttributeNames: Record<string, string> = {};
    const expressionAttributeValues: Record<string, unknown> = {};

    const fieldsToUpdate: Record<string, unknown> = {
      updatedAt: now(),
      updatedBy,
      version: existing.version + 1,
    };

    if (data.username !== undefined) {
      fieldsToUpdate.username = data.username;
    }

    if (data.profile) {
      fieldsToUpdate.profile = { ...existing.profile, ...data.profile };
    }

    if (data.preferences) {
      fieldsToUpdate.preferences = { ...existing.preferences, ...data.preferences };
    }

    if (data.tags) {
      fieldsToUpdate.tags = data.tags;
    }

    if (data.metadata) {
      fieldsToUpdate.metadata = { ...existing.metadata, ...data.metadata };
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

    return result.Attributes as User;
  }

  async delete(tenantId: string, id: string): Promise<void> {
    await dynamoDb.send(
      new DeleteCommand({
        TableName: this.tableName,
        Key: { tenantId, id },
        ConditionExpression: 'attribute_exists(id)',
      })
    );
  }

  async list(tenantId: string, params: ListUsersDTO): Promise<PaginatedResult<User>> {
    const limit = params.limit || 20;

    const filterExpressions: string[] = [];
    const expressionAttributeNames: Record<string, string> = {};
    const expressionAttributeValues: Record<string, unknown> = { ':tenantId': tenantId };

    if (params.customerId) {
      filterExpressions.push('customerId = :customerId');
      expressionAttributeValues[':customerId'] = params.customerId;
    }

    if (params.partnerId) {
      filterExpressions.push('partnerId = :partnerId');
      expressionAttributeValues[':partnerId'] = params.partnerId;
    }

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

    if (params.search) {
      filterExpressions.push('(contains(email, :search) OR contains(profile.firstName, :search) OR contains(profile.lastName, :search))');
      expressionAttributeValues[':search'] = params.search.toLowerCase();
    }

    const result = await dynamoDb.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'tenantId = :tenantId',
        FilterExpression: filterExpressions.length > 0 ? filterExpressions.join(' AND ') : undefined,
        ExpressionAttributeNames: Object.keys(expressionAttributeNames).length > 0 ? expressionAttributeNames : undefined,
        ExpressionAttributeValues: expressionAttributeValues,
        Limit: limit + 1,
        ExclusiveStartKey: params.cursor ? JSON.parse(Buffer.from(params.cursor, 'base64').toString()) : undefined,
      })
    );

    const items = (result.Items as User[]) || [];
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

  async listByCustomer(tenantId: string, customerId: string): Promise<User[]> {
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

    return (result.Items as User[]) || [];
  }

  async listByPartner(tenantId: string, partnerId: string): Promise<User[]> {
    const result = await dynamoDb.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: 'gsi-partner',
        KeyConditionExpression: 'tenantId = :tenantId AND partnerId = :partnerId',
        ExpressionAttributeValues: {
          ':tenantId': tenantId,
          ':partnerId': partnerId,
        },
      })
    );

    return (result.Items as User[]) || [];
  }

  async updateStatus(tenantId: string, id: string, status: UserStatus, updatedBy: string, reason?: string): Promise<User> {
    const existing = await this.getById(tenantId, id);
    if (!existing) {
      throw new AppError('USER_NOT_FOUND', 'User not found', 404);
    }

    const timestamp = now();
    const metadata = reason
      ? { ...existing.metadata, lastStatusChangeReason: reason, lastStatusChangeAt: timestamp }
      : existing.metadata;

    const result = await dynamoDb.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { tenantId, id },
        UpdateExpression: `SET #status = :status, updatedAt = :updatedAt, updatedBy = :updatedBy,
          metadata = :metadata, #version = #version + :inc`,
        ConditionExpression: '#version = :currentVersion',
        ExpressionAttributeNames: {
          '#status': 'status',
          '#version': 'version',
        },
        ExpressionAttributeValues: {
          ':status': status,
          ':updatedAt': timestamp,
          ':updatedBy': updatedBy,
          ':metadata': metadata,
          ':currentVersion': existing.version,
          ':inc': 1,
        },
        ReturnValues: 'ALL_NEW',
      })
    );

    return result.Attributes as User;
  }

  async updatePassword(tenantId: string, id: string, passwordHash: string): Promise<void> {
    const timestamp = now();

    await dynamoDb.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { tenantId, id },
        UpdateExpression: `SET security.passwordHash = :hash, security.passwordChangedAt = :timestamp,
          updatedAt = :timestamp`,
        ExpressionAttributeValues: {
          ':hash': passwordHash,
          ':timestamp': timestamp,
        },
      })
    );
  }

  async setPasswordResetToken(tenantId: string, id: string, token: string, expiresAt: string): Promise<void> {
    await dynamoDb.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { tenantId, id },
        UpdateExpression: `SET security.passwordResetToken = :token, security.passwordResetExpiresAt = :expiresAt,
          updatedAt = :now`,
        ExpressionAttributeValues: {
          ':token': token,
          ':expiresAt': expiresAt,
          ':now': now(),
        },
      })
    );
  }

  async clearPasswordResetToken(tenantId: string, id: string): Promise<void> {
    await dynamoDb.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { tenantId, id },
        UpdateExpression: `REMOVE security.passwordResetToken, security.passwordResetExpiresAt
          SET updatedAt = :now`,
        ExpressionAttributeValues: {
          ':now': now(),
        },
      })
    );
  }

  async setEmailVerificationToken(tenantId: string, id: string, token: string): Promise<void> {
    await dynamoDb.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { tenantId, id },
        UpdateExpression: `SET security.emailVerificationToken = :token, updatedAt = :now`,
        ExpressionAttributeValues: {
          ':token': token,
          ':now': now(),
        },
      })
    );
  }

  async verifyEmail(tenantId: string, id: string): Promise<void> {
    const timestamp = now();

    await dynamoDb.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { tenantId, id },
        UpdateExpression: `SET emailVerified = :verified, security.emailVerifiedAt = :timestamp,
          #status = :status, updatedAt = :timestamp
          REMOVE security.emailVerificationToken`,
        ExpressionAttributeNames: {
          '#status': 'status',
        },
        ExpressionAttributeValues: {
          ':verified': true,
          ':status': 'ACTIVE',
          ':timestamp': timestamp,
        },
      })
    );
  }

  async incrementFailedLoginAttempts(tenantId: string, id: string): Promise<number> {
    const result = await dynamoDb.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { tenantId, id },
        UpdateExpression: `SET security.failedLoginAttempts = if_not_exists(security.failedLoginAttempts, :zero) + :inc,
          updatedAt = :now`,
        ExpressionAttributeValues: {
          ':zero': 0,
          ':inc': 1,
          ':now': now(),
        },
        ReturnValues: 'ALL_NEW',
      })
    );

    return (result.Attributes as User).security.failedLoginAttempts;
  }

  async resetFailedLoginAttempts(tenantId: string, id: string): Promise<void> {
    await dynamoDb.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { tenantId, id },
        UpdateExpression: `SET security.failedLoginAttempts = :zero, updatedAt = :now`,
        ExpressionAttributeValues: {
          ':zero': 0,
          ':now': now(),
        },
      })
    );
  }

  async lockUser(tenantId: string, id: string, until: string): Promise<void> {
    await dynamoDb.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { tenantId, id },
        UpdateExpression: `SET security.lockedUntil = :until, #status = :status, updatedAt = :now`,
        ExpressionAttributeNames: {
          '#status': 'status',
        },
        ExpressionAttributeValues: {
          ':until': until,
          ':status': 'LOCKED',
          ':now': now(),
        },
      })
    );
  }

  async unlockUser(tenantId: string, id: string): Promise<void> {
    await dynamoDb.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { tenantId, id },
        UpdateExpression: `SET #status = :status, security.failedLoginAttempts = :zero, updatedAt = :now
          REMOVE security.lockedUntil`,
        ExpressionAttributeNames: {
          '#status': 'status',
        },
        ExpressionAttributeValues: {
          ':status': 'ACTIVE',
          ':zero': 0,
          ':now': now(),
        },
      })
    );
  }

  async enableMfa(tenantId: string, id: string, method: string, secret: string, backupCodes: string[]): Promise<void> {
    await dynamoDb.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { tenantId, id },
        UpdateExpression: `SET security.mfaEnabled = :enabled, security.mfaMethod = :method,
          security.mfaSecret = :secret, security.mfaBackupCodes = :codes, updatedAt = :now`,
        ExpressionAttributeValues: {
          ':enabled': true,
          ':method': method,
          ':secret': secret,
          ':codes': backupCodes,
          ':now': now(),
        },
      })
    );
  }

  async disableMfa(tenantId: string, id: string): Promise<void> {
    await dynamoDb.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { tenantId, id },
        UpdateExpression: `SET security.mfaEnabled = :disabled, updatedAt = :now
          REMOVE security.mfaMethod, security.mfaSecret, security.mfaBackupCodes`,
        ExpressionAttributeValues: {
          ':disabled': false,
          ':now': now(),
        },
      })
    );
  }

  async recordLogin(tenantId: string, id: string, ip: string): Promise<void> {
    const timestamp = now();

    await dynamoDb.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { tenantId, id },
        UpdateExpression: `SET security.lastLoginAt = :timestamp, security.lastLoginIp = :ip,
          security.failedLoginAttempts = :zero, updatedAt = :timestamp`,
        ExpressionAttributeValues: {
          ':timestamp': timestamp,
          ':ip': ip,
          ':zero': 0,
        },
      })
    );
  }

  async updateSessionCount(tenantId: string, id: string, count: number): Promise<void> {
    await dynamoDb.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { tenantId, id },
        UpdateExpression: `SET activeSessions = :count, updatedAt = :now`,
        ExpressionAttributeValues: {
          ':count': count,
          ':now': now(),
        },
      })
    );
  }

  async setInvitationAccepted(tenantId: string, id: string): Promise<void> {
    const timestamp = now();

    await dynamoDb.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { tenantId, id },
        UpdateExpression: `SET invitationAcceptedAt = :timestamp, #status = :status, updatedAt = :timestamp`,
        ExpressionAttributeNames: {
          '#status': 'status',
        },
        ExpressionAttributeValues: {
          ':timestamp': timestamp,
          ':status': 'ACTIVE',
        },
      })
    );
  }
}
