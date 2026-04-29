import { VisitaProduct } from '../../../domain/entities/qrc/VisitaProduct';
import { VisitaProductImage } from '../../../domain/entities/qrc/VisitaProductImage';

export interface IVisitaProductRepository {
  create(
    tenantId: string,
    ambienteId: string,
    data: {
      productType: string;
      description: string | null;
      quantity:    number;
      createdBy:   string;
    },
  ): Promise<VisitaProduct>;

  getById(tenantId: string, id: string): Promise<VisitaProduct | null>;
  listByAmbiente(tenantId: string, ambienteId: string): Promise<VisitaProduct[]>;

  update(
    tenantId: string,
    id: string,
    patch: Partial<{ productType: string; description: string | null; quantity: number }>,
  ): Promise<VisitaProduct>;

  delete(tenantId: string, id: string): Promise<void>;
}

export interface IVisitaProductImageRepository {
  create(
    tenantId: string,
    productId: string,
    data: { fileAssetId: string; imageOrder: number },
  ): Promise<VisitaProductImage>;

  listByProduct(tenantId: string, productId: string): Promise<VisitaProductImage[]>;
  countByProduct(tenantId: string, productId: string): Promise<number>;
  nextImageOrder(tenantId: string, productId: string): Promise<number>;

  delete(tenantId: string, id: string): Promise<void>;
}
