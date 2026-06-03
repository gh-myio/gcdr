import { NotFoundError, ConflictError, ValidationError } from '../../../src/shared/errors/AppError';
import type { UserContact } from '../../../src/repositories/UserContactRepository';

// --- Mocks (module singletons — the service is not constructor-injected) -----
const mockGetById = jest.fn();

jest.mock('../../../src/repositories/UserRepository', () => ({
  UserRepository: jest.fn(() => ({ getById: mockGetById })),
}));

jest.mock('../../../src/repositories/UserContactRepository', () => ({
  userContactRepository: {
    findByUser: jest.fn(),
    findByUserAndChannel: jest.fn(),
    create: jest.fn(),
    findById: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
}));

// Import AFTER the mocks are registered.
import { userContactService } from '../../../src/services/UserContactService';
import { userContactRepository } from '../../../src/repositories/UserContactRepository';

const repo = userContactRepository as jest.Mocked<typeof userContactRepository>;

const tenantId = '11111111-1111-1111-1111-111111111111';
const userId = '22222222-2222-2222-2222-222222222222';
const contactId = '33333333-3333-3333-3333-333333333333';

const mockUser = { id: userId, tenantId, email: 'u@test.com' };

function makeContact(overrides: Partial<UserContact> = {}): UserContact {
  return {
    id: contactId,
    tenantId,
    userId,
    channel: 'EMAIL',
    value: 'jane@example.com',
    label: 'work',
    verified: false,
    active: true,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetById.mockResolvedValue(mockUser);
});

describe('UserContactService.list', () => {
  it('returns the user contacts', async () => {
    const contacts = [makeContact()];
    repo.findByUser.mockResolvedValue(contacts);

    const result = await userContactService.list(tenantId, userId);

    expect(result).toBe(contacts);
    expect(repo.findByUser).toHaveBeenCalledWith(tenantId, userId);
  });

  it('throws NotFoundError when the user does not exist', async () => {
    mockGetById.mockResolvedValue(null);
    await expect(userContactService.list(tenantId, userId)).rejects.toThrow(NotFoundError);
    expect(repo.findByUser).not.toHaveBeenCalled();
  });
});

describe('UserContactService.create', () => {
  it('creates a contact when there is no duplicate', async () => {
    repo.findByUserAndChannel.mockResolvedValue([]);
    const created = makeContact();
    repo.create.mockResolvedValue(created);

    const result = await userContactService.create(tenantId, userId, {
      channel: 'EMAIL',
      value: 'jane@example.com',
      active: true,
    });

    expect(result).toBe(created);
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId, userId, channel: 'EMAIL', value: 'jane@example.com' }),
    );
  });

  it('throws ConflictError on duplicate channel+value', async () => {
    repo.findByUserAndChannel.mockResolvedValue([makeContact()]);

    await expect(
      userContactService.create(tenantId, userId, {
        channel: 'EMAIL',
        value: 'jane@example.com',
        active: true,
      }),
    ).rejects.toThrow(ConflictError);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('throws NotFoundError when the user does not exist', async () => {
    mockGetById.mockResolvedValue(null);
    await expect(
      userContactService.create(tenantId, userId, { channel: 'EMAIL', value: 'x@y.com', active: true }),
    ).rejects.toThrow(NotFoundError);
  });
});

describe('UserContactService.update', () => {
  it('updates a contact that belongs to the user', async () => {
    repo.findById.mockResolvedValue(makeContact());
    const updated = makeContact({ value: 'new@example.com' });
    repo.update.mockResolvedValue(updated);

    const result = await userContactService.update(tenantId, userId, contactId, {
      value: 'new@example.com',
    });

    expect(result).toBe(updated);
    expect(repo.update).toHaveBeenCalledWith(tenantId, contactId, { value: 'new@example.com' });
  });

  it('throws NotFoundError when the contact belongs to another user', async () => {
    repo.findById.mockResolvedValue(makeContact({ userId: 'someone-else' }));

    await expect(
      userContactService.update(tenantId, userId, contactId, { value: 'new@example.com' }),
    ).rejects.toThrow(NotFoundError);
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('throws ValidationError when the new value is invalid for the channel', async () => {
    repo.findById.mockResolvedValue(makeContact({ channel: 'EMAIL' }));

    await expect(
      userContactService.update(tenantId, userId, contactId, { value: 'not-an-email' }),
    ).rejects.toThrow(ValidationError);
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('allows label/active updates without revalidating value', async () => {
    repo.findById.mockResolvedValue(makeContact());
    const updated = makeContact({ active: false });
    repo.update.mockResolvedValue(updated);

    const result = await userContactService.update(tenantId, userId, contactId, { active: false });

    expect(result).toBe(updated);
    expect(repo.update).toHaveBeenCalledWith(tenantId, contactId, { active: false });
  });
});

describe('UserContactService.delete', () => {
  it('deletes a contact that belongs to the user', async () => {
    repo.findById.mockResolvedValue(makeContact());
    repo.delete.mockResolvedValue(true);

    await userContactService.delete(tenantId, userId, contactId);

    expect(repo.delete).toHaveBeenCalledWith(tenantId, contactId);
  });

  it('throws NotFoundError when the contact does not exist', async () => {
    repo.findById.mockResolvedValue(null);

    await expect(userContactService.delete(tenantId, userId, contactId)).rejects.toThrow(NotFoundError);
    expect(repo.delete).not.toHaveBeenCalled();
  });
});
