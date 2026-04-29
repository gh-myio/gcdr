import { VisitaAudit } from '../../../domain/entities/qrc/VisitaAudit';

export interface IVisitaAuditRepository {
  /** Append an audit row. Revision is auto-assigned monotonically per visitaId. */
  append(
    tenantId: string,
    visitaId: string,
    data: {
      ambienteId:        string | null;
      changeType:        string;
      changeDescription: string | null;
      oldValue:          Record<string, unknown> | null;
      newValue:          Record<string, unknown> | null;
      changedBy:         string;
    },
  ): Promise<VisitaAudit>;

  listByVisita(tenantId: string, visitaId: string): Promise<VisitaAudit[]>;
}
