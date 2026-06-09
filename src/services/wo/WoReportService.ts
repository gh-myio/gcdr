import { InstallationStatus } from '../../domain/entities/wo/Installation';
import { Visita } from '../../domain/entities/wo/Visita';
import { IInstallationRepository } from '../../repositories/interfaces/wo/IInstallationRepository';
import { IDeviceRepository } from '../../repositories/interfaces/IDeviceRepository';
import { installationRepository } from '../../repositories/wo/InstallationRepository';
import { DeviceRepository } from '../../repositories/DeviceRepository';
import { ICustomerRepository } from '../../repositories/interfaces/ICustomerRepository';
import { CustomerRepository } from '../../repositories/CustomerRepository';
import { IVisitaRepository } from '../../repositories/interfaces/wo/IVisitaRepository';
import { visitaRepository } from '../../repositories/wo/VisitaRepository';
import { IVisitaAmbienteRepository } from '../../repositories/interfaces/wo/IVisitaAmbienteRepository';
import { visitaAmbienteRepository } from '../../repositories/wo/VisitaAmbienteRepository';
import { NotFoundError } from '../../shared/errors/AppError';

export interface CustomerProgressReport {
  customerId:        string;
  customerName:      string;
  customerCode:      string;
  totalDevices:      number;
  installedCount:    number;
  impedimentoCount:  number;
  removidoCount:     number;
  defeitoCount:      number;
  pendingCount:      number;
  progressPercent:   number;
  lastInstalledAt:   string | null;
}

export interface VisitaReport {
  visita:        Visita;
  ambienteCount: number;
  productCount:  number;
}

export class WoReportService {
  constructor(
    private readonly installationRepo: IInstallationRepository = installationRepository,
    private readonly deviceRepo: IDeviceRepository = new DeviceRepository(),
    private readonly customerRepo: ICustomerRepository = new CustomerRepository(),
    private readonly visitaRepo: IVisitaRepository = visitaRepository,
    private readonly ambienteRepo: IVisitaAmbienteRepository = visitaAmbienteRepository,
  ) {}

  /**
   * Per-customer installation progress. Used by /wo/customers
   * (with `?include=stats`) and /wo/customers/:id/report.
   */
  async customerReport(tenantId: string, customerId: string): Promise<CustomerProgressReport> {
    const customer = await this.customerRepo.getById(tenantId, customerId);
    if (!customer) throw new NotFoundError(`Customer ${customerId} not found`);

    const totalDevices = await this.deviceRepo.countByCustomer(tenantId, customerId);
    const counts = await this.installationRepo.countByStatusForCustomer(tenantId, customerId);
    const installations = await this.installationRepo.listByCustomer(tenantId, customerId);

    const installedCount: number   = counts.instalado;
    const impedimentoCount: number = counts.impedimento;
    const removidoCount: number    = counts.removido;
    const defeitoCount: number     = counts.defeito;
    const installedTotal           = installedCount + impedimentoCount + removidoCount + defeitoCount;

    const lastInstalledAt = installations.length
      ? installations.reduce((latest, i) => {
          if (!latest) return i.installedAt;
          return new Date(i.installedAt) > new Date(latest) ? i.installedAt : latest;
        }, null as string | null)
      : null;

    return {
      customerId:       customer.id,
      customerName:     customer.name,
      customerCode:     customer.code,
      totalDevices,
      installedCount,
      impedimentoCount,
      removidoCount,
      defeitoCount,
      pendingCount:     Math.max(0, totalDevices - installedTotal),
      progressPercent:  totalDevices === 0 ? 0 : (installedTotal / totalDevices) * 100,
      lastInstalledAt,
    };
  }

  async visitaReport(tenantId: string, visitaId: string): Promise<VisitaReport> {
    const visita = await this.visitaRepo.getById(tenantId, visitaId);
    if (!visita) throw new NotFoundError(`Visita ${visitaId} not found`);

    const ambientes = await this.ambienteRepo.listByVisita(tenantId, visitaId);
    return {
      visita,
      ambienteCount: ambientes.length,
      productCount:  0,  // TODO: count products across all ambientes; cheap follow-up.
    };
  }
}

export const woReportService = new WoReportService();
