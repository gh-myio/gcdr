import { VisitaAmbiente } from '../../../domain/entities/qrc/VisitaAmbiente';
import { VisitaAmbienteImage } from '../../../domain/entities/qrc/VisitaAmbienteImage';

export interface IVisitaAmbienteRepository {
  create(
    tenantId: string,
    visitaId: string,
    data: {
      name:            string;
      observation:     string | null;
      acQuantity:      number | null;
      productQuantity: number | null;
      productType:     string | null;
      createdBy:       string;
    },
  ): Promise<VisitaAmbiente>;

  getById(tenantId: string, id: string): Promise<VisitaAmbiente | null>;
  listByVisita(tenantId: string, visitaId: string): Promise<VisitaAmbiente[]>;

  update(
    tenantId: string,
    id: string,
    patch: Partial<{
      name:            string;
      observation:     string | null;
      acQuantity:      number | null;
      productQuantity: number | null;
      productType:     string | null;
    }>,
  ): Promise<VisitaAmbiente>;

  delete(tenantId: string, id: string): Promise<void>;
}

export interface IVisitaAmbienteImageRepository {
  create(
    tenantId: string,
    ambienteId: string,
    data: { fileAssetId: string; imageOrder: number; caption: string | null },
  ): Promise<VisitaAmbienteImage>;

  listByAmbiente(tenantId: string, ambienteId: string): Promise<VisitaAmbienteImage[]>;
  countByAmbiente(tenantId: string, ambienteId: string): Promise<number>;
  nextImageOrder(tenantId: string, ambienteId: string): Promise<number>;

  update(
    tenantId: string,
    id: string,
    patch: { imageOrder?: number; caption?: string | null },
  ): Promise<VisitaAmbienteImage>;

  delete(tenantId: string, id: string): Promise<void>;
}
