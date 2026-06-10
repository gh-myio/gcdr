import { AnnotationService } from '../../../src/services/AnnotationService';
import { ConflictError } from '../../../src/shared/errors/AppError';
import type { IAnnotationRepository } from '../../../src/repositories/annotations/interfaces/IAnnotationRepository';

const tenantId = '11111111-1111-1111-1111-111111111111';
const userId = '22222222-2222-2222-2222-222222222222';
const annId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

// Pre-resolved actor so the service never reaches the userRepository singleton.
const ctx = { tenantId, userId, actor: { id: userId, email: 'u@example.com', name: 'U' } };

function makeService(annotation: Record<string, unknown>) {
  const repo = {
    getById: jest.fn().mockResolvedValue(annotation),
    getDetail: jest.fn().mockResolvedValue({ ...annotation, responses: [], events: [], mentions: [], attachments: [] }),
    update: jest.fn().mockResolvedValue({ ...annotation, status: 'modified', version: 2 }),
    finalize: jest.fn().mockResolvedValue({ ...annotation, finalized: true }),
    addResponse: jest.fn().mockResolvedValue({ id: 'resp-1', type: 'comment' }),
    addEvent: jest.fn().mockResolvedValue(undefined),
  };
  const service = new AnnotationService(repo as unknown as IAnnotationRepository);
  return { service, repo };
}

describe('AnnotationService — lifecycle & finalization', () => {
  it('edits an active annotation, bumps version and emits a modified event', async () => {
    const { service, repo } = makeService({
      id: annId, text: 'old', type: 'observation', importance: 3, version: 1, finalized: false, status: 'created',
    });

    await service.update(ctx, annId, { text: 'new' } as never);

    expect(repo.update).toHaveBeenCalledWith(
      tenantId, annId, expect.objectContaining({ status: 'modified', expectedVersion: 1 }),
    );
    expect(repo.addEvent).toHaveBeenCalledWith(
      tenantId, annId, 'modified', expect.anything(), expect.anything(),
    );
  });

  it('returns 409 (ConflictError) when the optimistic lock fails on edit', async () => {
    const { service, repo } = makeService({
      id: annId, text: 'old', type: 'observation', importance: 3, version: 5, finalized: false, status: 'created',
    });
    repo.update.mockResolvedValue(null); // stale version → repo returns null

    await expect(service.update(ctx, annId, { text: 'new', version: 2 } as never)).rejects.toThrow(ConflictError);
  });

  it('refuses to edit a finalized annotation', async () => {
    const { service } = makeService({
      id: annId, text: 'x', version: 1, finalized: true, finalizedReason: 'approved', status: 'created',
    });

    await expect(service.update(ctx, annId, { text: 'new' } as never)).rejects.toThrow(ConflictError);
  });

  it('a comment response does NOT finalize and does NOT change status', async () => {
    const { service, repo } = makeService({
      id: annId, version: 1, finalized: false, status: 'created',
    });

    await service.addResponse(ctx, annId, { type: 'comment', text: 'hi' } as never);

    expect(repo.finalize).not.toHaveBeenCalled();
    expect(repo.addEvent).toHaveBeenCalledWith(tenantId, annId, 'commented', expect.anything(), expect.anything());
  });

  it('an approved response finalizes the annotation', async () => {
    const { service, repo } = makeService({
      id: annId, version: 1, finalized: false, status: 'created',
    });
    repo.addResponse.mockResolvedValue({ id: 'resp-1', type: 'approved' });

    await service.addResponse(ctx, annId, { type: 'approved' } as never);

    expect(repo.finalize).toHaveBeenCalledWith(
      tenantId, annId, 'approved', 'created', expect.anything(), 1,
    );
    expect(repo.addEvent).toHaveBeenCalledWith(tenantId, annId, 'approved', expect.anything(), expect.anything());
  });

  it('refuses to respond to a finalized annotation', async () => {
    const { service } = makeService({
      id: annId, version: 1, finalized: true, finalizedReason: 'rejected', status: 'created',
    });

    await expect(service.addResponse(ctx, annId, { type: 'comment', text: 'late' } as never)).rejects.toThrow(ConflictError);
  });
});
