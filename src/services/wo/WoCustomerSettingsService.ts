import bcrypt from 'bcryptjs';
import {
  WoCustomerSettingsRepository,
  woCustomerSettingsRepository,
} from '../../repositories/wo/WoCustomerSettingsRepository';
import { CustomerRepository } from '../../repositories/CustomerRepository';
import { ICustomerRepository } from '../../repositories/interfaces/ICustomerRepository';
import { IWoCustomerSettingsRepository } from '../../repositories/interfaces/wo/IWoCustomerSettingsRepository';
import { WoCustomerSettings } from '../../domain/entities/wo/CustomerSettings';
import { NotFoundError } from '../../shared/errors/AppError';

export interface EnableInput {
  defaultCentralId?: string | null;
  viewerPassword?:   string | null;
  woMetadata?:      Record<string, unknown>;
}

export interface UpdateInput {
  defaultCentralId?: string | null;
  viewerPassword?:   string | null;
  woMetadata?:      Record<string, unknown>;
}

const VIEWER_PASSWORD_BCRYPT_COST = 10;

export class WoCustomerSettingsService {
  constructor(
    private readonly settingsRepo: IWoCustomerSettingsRepository = woCustomerSettingsRepository,
    private readonly customerRepo: ICustomerRepository = new CustomerRepository(),
  ) {}

  /**
   * Mark a customer as QR-enabled. Throws CONFLICT if already enabled.
   */
  async enable(
    tenantId: string,
    customerId: string,
    input: EnableInput,
    createdBy: string,
  ): Promise<WoCustomerSettings> {
    const customer = await this.customerRepo.getById(tenantId, customerId);
    if (!customer) throw new NotFoundError(`Customer ${customerId} not found`);

    const viewerPasswordHash = input.viewerPassword
      ? await bcrypt.hash(input.viewerPassword, VIEWER_PASSWORD_BCRYPT_COST)
      : null;

    return this.settingsRepo.enable(tenantId, customerId, {
      viewerPasswordHash,
      defaultCentralId: input.defaultCentralId ?? null,
      woMetadata:      input.woMetadata ?? {},
    }, createdBy);
  }

  async update(tenantId: string, customerId: string, input: UpdateInput): Promise<WoCustomerSettings> {
    const patch: Parameters<IWoCustomerSettingsRepository['update']>[2] = {};

    if (input.viewerPassword !== undefined) {
      patch.viewerPasswordHash = input.viewerPassword === null
        ? null
        : await bcrypt.hash(input.viewerPassword, VIEWER_PASSWORD_BCRYPT_COST);
    }
    if (input.defaultCentralId !== undefined) patch.defaultCentralId = input.defaultCentralId;
    if (input.woMetadata !== undefined)      patch.woMetadata = input.woMetadata;

    return this.settingsRepo.update(tenantId, customerId, patch);
  }

  /**
   * Verify a candidate viewer password. Returns true on match.
   */
  async verifyViewerPassword(tenantId: string, customerId: string, candidate: string): Promise<boolean> {
    const settings = await this.settingsRepo.getByCustomerId(tenantId, customerId);
    if (!settings || !settings.viewerPasswordHash) return false;
    return bcrypt.compare(candidate, settings.viewerPasswordHash);
  }

  /**
   * Soft-disable: drops the wo_customer_settings row. The customer row
   * itself is preserved, as are installations / observations / images
   * already created. Re-enabling restores the QR feature without data
   * recovery work.
   */
  async disable(tenantId: string, customerId: string): Promise<void> {
    return this.settingsRepo.disable(tenantId, customerId);
  }

  async getByCustomerId(tenantId: string, customerId: string): Promise<WoCustomerSettings | null> {
    return this.settingsRepo.getByCustomerId(tenantId, customerId);
  }

  async listEnabled(tenantId: string): Promise<WoCustomerSettings[]> {
    return this.settingsRepo.listEnabled(tenantId);
  }
}

export const woCustomerSettingsService = new WoCustomerSettingsService();
