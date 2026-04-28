// RFC-0032 — Photo of a Visita product.

export interface VisitaProductImage {
  id: string;
  tenantId: string;
  productId: string;
  /** FK to file_assets.id (with owner_type='qrc_visita_product'). */
  fileAssetId: string;
  imageOrder: number;
  createdAt: string;
}
