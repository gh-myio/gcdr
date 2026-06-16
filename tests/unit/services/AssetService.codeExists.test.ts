// Unit tests for AssetService.codeExists — the per-customer asset code existence
// check backing GET /assets/exists. Mocks IAssetRepository.getByCode.
import { AssetService } from '../../../src/services/AssetService';
import { IAssetRepository } from '../../../src/repositories/interfaces/IAssetRepository';
import { ICustomerRepository } from '../../../src/repositories/interfaces/ICustomerRepository';
import { Asset } from '../../../src/domain/entities/Asset';

const TENANT = 'tenant-1';
const CUSTOMER = 'customer-1';

const asset = { id: 'asset-1', tenantId: TENANT, customerId: CUSTOMER, code: 'DIM-MAIN' } as unknown as Asset;

describe('AssetService.codeExists', () => {
  let repo: jest.Mocked<IAssetRepository>;
  let service: AssetService;

  beforeEach(() => {
    repo = { getByCode: jest.fn() } as unknown as jest.Mocked<IAssetRepository>;
    service = new AssetService(repo, {} as unknown as ICustomerRepository);
  });

  it('reports exists:true when the customer already has the code', async () => {
    repo.getByCode.mockResolvedValue(asset);
    const r = await service.codeExists(TENANT, CUSTOMER, 'DIM-MAIN');
    expect(repo.getByCode).toHaveBeenCalledWith(TENANT, CUSTOMER, 'DIM-MAIN');
    expect(r).toEqual({ exists: true, count: 1 });
  });

  it('reports exists:false when the code is free for that customer', async () => {
    repo.getByCode.mockResolvedValue(null);
    const r = await service.codeExists(TENANT, CUSTOMER, 'DIM-FREE');
    expect(r).toEqual({ exists: false, count: 0 });
  });

  it('trims and short-circuits on a blank code without hitting the repo', async () => {
    const r = await service.codeExists(TENANT, CUSTOMER, '  ');
    expect(r).toEqual({ exists: false, count: 0 });
    expect(repo.getByCode).not.toHaveBeenCalled();
  });
});
