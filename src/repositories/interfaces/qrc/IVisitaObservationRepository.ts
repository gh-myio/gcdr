import { VisitaObservation } from '../../../domain/entities/qrc/VisitaObservation';

export interface IVisitaObservationRepository {
  create(
    tenantId: string,
    visitaId: string,
    data: { observation: string; fileAssetId: string | null; createdBy: string },
  ): Promise<VisitaObservation>;

  listByVisita(tenantId: string, visitaId: string): Promise<VisitaObservation[]>;

  delete(tenantId: string, id: string): Promise<void>;
}
