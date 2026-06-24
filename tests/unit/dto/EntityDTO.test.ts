import {
  CreateEntitySchema,
  UpdateEntitySchema,
  ListEntitiesQuerySchema,
  CloneSchema,
  BulkReplaceSchema,
  ClassificationMetadataSchema,
  ENTITY_METADATA_SCHEMAS,
  validateMetadataForType,
  safeValidateMetadataForType,
} from '../../../src/dto/request/EntityDTO';

describe('CreateEntitySchema', () => {
  it('accepts a minimal valid create and applies defaults', () => {
    const data = CreateEntitySchema.parse({ entityType: 'GROUP', entityKey: 'energy-commonarea' });
    expect(data.sortOrder).toBe(0);
    expect(data.isActive).toBe(true);
    expect(data.metadata).toEqual({});
  });

  it('rejects a bad entity_type token', () => {
    const result = CreateEntitySchema.safeParse({ entityType: 'bad type!', entityKey: 'k' });
    expect(result.success).toBe(false);
  });

  it('rejects an empty entity_key', () => {
    const result = CreateEntitySchema.safeParse({ entityType: 'GROUP', entityKey: '' });
    expect(result.success).toBe(false);
  });

  it('rejects a non-uuid parentEntityId', () => {
    const result = CreateEntitySchema.safeParse({ entityType: 'GROUP', entityKey: 'k', parentEntityId: 'nope' });
    expect(result.success).toBe(false);
  });

  it('accepts a null customerId (system default)', () => {
    const data = CreateEntitySchema.parse({ entityType: 'GROUP', entityKey: 'k', customerId: null });
    expect(data.customerId).toBeNull();
  });
});

describe('UpdateEntitySchema', () => {
  it('accepts a partial update', () => {
    const data = UpdateEntitySchema.parse({ entityValue: 'Chiller A', version: 3 });
    expect(data.entityValue).toBe('Chiller A');
    expect(data.version).toBe(3);
  });

  it('rejects a non-positive version', () => {
    const result = UpdateEntitySchema.safeParse({ version: 0 });
    expect(result.success).toBe(false);
  });
});

describe('ListEntitiesQuerySchema', () => {
  it('defaults scope/state/deep/page/pageSize/sort', () => {
    const q = ListEntitiesQuerySchema.parse({});
    expect(q.scope).toBe('system');
    expect(q.state).toBe('active');
    expect(q.deep).toBe(0);
    expect(q.page).toBe(1);
    expect(q.pageSize).toBe(50);
    expect(q.sort).toBe('sort_order_asc');
  });

  it('coerces a single type into an array', () => {
    const q = ListEntitiesQuerySchema.parse({ type: 'GROUP' });
    expect(q.type).toEqual(['GROUP']);
  });

  it('accepts repeated type as an array', () => {
    const q = ListEntitiesQuerySchema.parse({ type: ['GROUP', 'PROFILE'] });
    expect(q.type).toEqual(['GROUP', 'PROFILE']);
  });

  it('accepts parentId literal "null"', () => {
    const q = ListEntitiesQuerySchema.parse({ parentId: 'null' });
    expect(q.parentId).toBe('null');
  });

  it('accepts deep="all"', () => {
    const q = ListEntitiesQuerySchema.parse({ deep: 'all' });
    expect(q.deep).toBe('all');
  });

  it('rejects deep over the max depth', () => {
    const result = ListEntitiesQuerySchema.safeParse({ deep: '99' });
    expect(result.success).toBe(false);
  });

  it('rejects pageSize over the cap', () => {
    const result = ListEntitiesQuerySchema.safeParse({ pageSize: '500' });
    expect(result.success).toBe(false);
  });

  it('rejects a bad sort field', () => {
    const result = ListEntitiesQuerySchema.safeParse({ sort: 'nonsense_asc' });
    expect(result.success).toBe(false);
  });

  it('rejects a bad sort direction', () => {
    const result = ListEntitiesQuerySchema.safeParse({ sort: 'sort_order_sideways' });
    expect(result.success).toBe(false);
  });

  it('passes through metadata.<path> containment keys', () => {
    const q = ListEntitiesQuerySchema.parse({ 'metadata.ingestionId': 'ing_123' });
    expect((q as Record<string, unknown>)['metadata.ingestionId']).toBe('ing_123');
  });
});

describe('CloneSchema', () => {
  it('requires a uuid customerId', () => {
    expect(CloneSchema.safeParse({ customerId: 'not-a-uuid' }).success).toBe(false);
    expect(CloneSchema.safeParse({ customerId: '84e0370e-636a-4741-9874-504b5e0b3577' }).success).toBe(true);
  });
});

describe('BulkReplaceSchema (recursive)', () => {
  it('accepts a nested forest', () => {
    const result = BulkReplaceSchema.safeParse({
      roots: [
        { entityKey: 'energy', sortOrder: 10, children: [{ entityKey: 'CHILLER', metadata: { label: 'Chiller' } }] },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects a node missing entityKey', () => {
    const result = BulkReplaceSchema.safeParse({ roots: [{ entityValue: 'x' }] });
    expect(result.success).toBe(false);
  });
});

describe('ClassificationMetadataSchema (.strict())', () => {
  it('accepts a valid classification metadata', () => {
    const data = ClassificationMetadataSchema.parse({
      label: 'Common Area',
      domain: 'energy',
      icon: 'bolt',
      role: 'aggregate',
      rules: { match: { deviceProfiles: ['x'] } },
      formula: 'sum(children)',
    });
    expect(data.label).toBe('Common Area');
  });

  it('requires label', () => {
    expect(ClassificationMetadataSchema.safeParse({ icon: 'bolt' }).success).toBe(false);
  });

  it('rejects an unknown key (strict)', () => {
    expect(ClassificationMetadataSchema.safeParse({ label: 'x', bogus: 1 }).success).toBe(false);
  });
});

describe('validateMetadataForType', () => {
  const classificationTypes = [
    'CLASSIFICATION_ENERGY',
    'CLASSIFICATION_WATER',
    'CLASSIFICATION_TEMPERATURE',
    'CLASSIFICATION_NODE',
  ] as const;

  it('registers a strict schema for every classification type', () => {
    for (const t of classificationTypes) {
      expect(ENTITY_METADATA_SCHEMAS[t]).toBeDefined();
    }
  });

  it.each(classificationTypes)('accepts valid metadata for %s', (type) => {
    const out = validateMetadataForType(type, { label: 'OK', role: 'leaf' });
    expect(out).toEqual({ label: 'OK', role: 'leaf' });
  });

  it.each(classificationTypes)('rejects an unknown key for %s', (type) => {
    expect(() => validateMetadataForType(type, { label: 'OK', extra: true })).toThrow();
  });

  it.each(classificationTypes)('rejects missing label for %s', (type) => {
    expect(() => validateMetadataForType(type, { role: 'leaf' })).toThrow();
  });

  it('passes through free-form metadata for an unregistered type', () => {
    const meta = { anything: 'goes', nested: { ok: true } };
    expect(validateMetadataForType('GROUP', meta)).toEqual(meta);
  });

  it('safeValidateMetadataForType returns success=false on a bad write', () => {
    const result = safeValidateMetadataForType('CLASSIFICATION_ENERGY', { bogus: 1 } as Record<string, unknown>);
    expect(result.success).toBe(false);
  });

  it('safeValidateMetadataForType returns success=true for free-form types', () => {
    const result = safeValidateMetadataForType('GROUP', { anything: 1 });
    expect(result.success).toBe(true);
  });
});
