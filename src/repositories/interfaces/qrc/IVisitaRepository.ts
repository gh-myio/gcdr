import { Visita, VisitaStatus } from '../../../domain/entities/qrc/Visita';

export interface IVisitaRepository {
  create(
    tenantId: string,
    data: {
      customerId:  string | null;
      name:        string;
      observation: string | null;
      createdBy:   string;
    },
  ): Promise<Visita>;

  getById(tenantId: string, id: string): Promise<Visita | null>;

  list(
    tenantId: string,
    params?: { customerId?: string; status?: VisitaStatus; limit?: number; offset?: number },
  ): Promise<{ items: Visita[]; total: number }>;

  update(
    tenantId: string,
    id: string,
    patch: Partial<{
      customerId:  string | null;
      name:        string;
      observation: string | null;
      status:      VisitaStatus;
    }>,
  ): Promise<Visita>;

  softDelete(tenantId: string, id: string): Promise<void>;
}
