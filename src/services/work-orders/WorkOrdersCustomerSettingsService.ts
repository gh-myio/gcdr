import bcrypt from 'bcryptjs';
import {
  workOrdersCustomerSettingsRepository,
} from '../../repositories/work-orders/WorkOrdersCustomerSettingsRepository';
import { CustomerRepository } from '../../repositories/CustomerRepository';
import { ICustomerRepository } from '../../repositories/interfaces/ICustomerRepository';
import { IWorkOrdersCustomerSettingsRepository } from '../../repositories/interfaces/work-orders/IWorkOrdersCustomerSettingsRepository';
import { WorkOrdersCustomerSettings } from '../../domain/entities/work-orders';
import { NotFoundError } from '../../shared/errors/AppError';

export interface EnableInput {
  defaultCentralId?: string | null;
  viewerPassword?:   string | null;
  woMetadata?:       Record<string, unknown>;
}

export interface UpdateInput {
  defaultCentralId?: string | null;
  viewerPassword?:   string | null;
  woMetadata?:       Record<string, unknown>;
}

const VIEWER_PASSWORD_BCRYPT_COST = 10;

export class WorkOrdersCustomerSettingsService {
  constructor(
    private readonly settingsRepo: IWorkOrdersCustomerSettingsRepository = workOrdersCustomerSettingsRepository,
    private readonly customerRepo: ICustomerRepository = new CustomerRepository(),
  ) {}

  /** Mark a customer as WO-enabled. Throws CONFLICT if already enabled. */
  async enable(
    tenantId: string,
    customerId: string,
    input: EnableInput,
    createdBy: string,
  ): Promise<WorkOrdersCustomerSettings> {
    const customer = await this.customerRepo.getById(tenantId, customerId);
    if (!customer) throw new NotFoundError(`Customer ${customerId} not found`);

    const viewerPasswordHash = input.viewerPassword
      ? await bcrypt.hash(input.viewerPassword, VIEWER_PASSWORD_BCRYPT_COST)
      : null;

    return this.settingsRepo.enable(tenantId, customerId, {
      viewerPasswordHash,
      defaultCentralId: input.defaultCentralId ?? null,
      woMetadata:       input.woMetadata ?? {},
    }, createdBy);
  }

  async update(tenantId: string, customerId: string, input: UpdateInput): Promise<WorkOrdersCustomerSettings> {
    const patch: Parameters<IWorkOrdersCustomerSettingsRepository['update']>[2] = {};

    if (input.viewerPassword !== undefined) {
      patch.viewerPasswordHash = input.viewerPassword === null
        ? null
        : await bcrypt.hash(input.viewerPassword, VIEWER_PASSWORD_BCRYPT_COST);
    }
    if (input.defaultCentralId !== undefined) patch.defaultCentralId = input.defaultCentralId;
    if (input.woMetadata !== undefined)       patch.woMetadata = input.woMetadata;

    return this.settingsRepo.update(tenantId, customerId, patch);
  }

  /** Verify a candidate viewer password. Returns true on match. */
  async verifyViewerPassword(tenantId: string, customerId: string, candidate: string): Promise<boolean> {
    const settings = await this.settingsRepo.getByCustomerId(tenantId, customerId);
    if (!settings || !settings.viewerPasswordHash) return false;
    return bcrypt.compare(candidate, settings.viewerPasswordHash);
  }

  /** Soft-disable: drops the work_orders_customer_settings row (customer preserved). */
  async disable(tenantId: string, customerId: string): Promise<void> {
    return this.settingsRepo.disable(tenantId, customerId);
  }

  async getByCustomerId(tenantId: string, customerId: string): Promise<WorkOrdersCustomerSettings | null> {
    return this.settingsRepo.getByCustomerId(tenantId, customerId);
  }

  async listEnabled(tenantId: string): Promise<WorkOrdersCustomerSettings[]> {
    return this.settingsRepo.listEnabled(tenantId);
  }
}

export const workOrdersCustomerSettingsService = new WorkOrdersCustomerSettingsService();
