import { deviceRepository } from '../repositories/DeviceRepository';
import { centralRepository } from '../repositories/CentralRepository';
import { customerRepository } from '../repositories/CustomerRepository';
import { EnrichmentResolveInput } from '../dto/request/EnrichmentDTO';

/**
 * RFC-0055 (ED-1080) — Enrichment service.
 *
 * Batch-resolves entity IDs to display metadata so the Alarms Orchestrator can
 * hydrate incidents (which store only IDs). Everything is scoped to the caller's
 * tenant; IDs not found (or belonging to another tenant) are omitted.
 */

export interface EnrichedDevice {
  id: string;
  name: string;
  slaveId: number | null;
  centralId: string | null;
}

export interface EnrichedCentral {
  id: string;
  name: string;
}

export interface EnrichedCustomer {
  id: string;
  name: string;
}

export interface EnrichmentResult {
  devices: Record<string, EnrichedDevice>;
  centrals: Record<string, EnrichedCentral>;
  customers: Record<string, EnrichedCustomer>;
}

export class EnrichmentService {
  async resolve(tenantId: string, input: EnrichmentResolveInput): Promise<EnrichmentResult> {
    // Dedupe ids before hitting the DB.
    const deviceIds = [...new Set(input.deviceIds)];
    const centralIds = [...new Set(input.centralIds)];
    const customerIds = [...new Set(input.customerIds)];

    const [deviceRows, centralRows, customerRows] = await Promise.all([
      deviceRepository.findByIds(tenantId, deviceIds),
      centralRepository.findByIds(tenantId, centralIds),
      customerRepository.findByIds(tenantId, customerIds),
    ]);

    const devices: Record<string, EnrichedDevice> = {};
    for (const d of deviceRows) {
      devices[d.id] = {
        id: d.id,
        name: d.name,
        slaveId: d.slaveId ?? null,
        centralId: d.centralId ?? null,
      };
    }

    const centrals: Record<string, EnrichedCentral> = {};
    for (const c of centralRows) {
      centrals[c.id] = { id: c.id, name: c.name };
    }

    const customers: Record<string, EnrichedCustomer> = {};
    for (const c of customerRows) {
      customers[c.id] = { id: c.id, name: c.name };
    }

    return { devices, centrals, customers };
  }
}

export const enrichmentService = new EnrichmentService();
