import { eq, and, desc } from 'drizzle-orm';
import { db, schema } from '../../infrastructure/database/drizzle/db';
import { CustomerObservation } from '../../domain/entities/wo/CustomerObservation';
import { ICustomerObservationRepository } from '../interfaces/wo/ICustomerObservationRepository';

const { woCustomerObservations } = schema;

export class CustomerObservationRepository implements ICustomerObservationRepository {
  async create(
    tenantId: string,
    customerId: string,
    data: { observation: string; fileAssetId: string | null; createdBy: string },
  ): Promise<CustomerObservation> {
    const [row] = await db.insert(woCustomerObservations).values({
      tenantId,
      customerId,
      observation: data.observation,
      fileAssetId: data.fileAssetId,
      createdBy:   data.createdBy,
    }).returning();
    return this.mapToEntity(row);
  }

  async getById(tenantId: string, id: string): Promise<CustomerObservation | null> {
    const [row] = await db
      .select()
      .from(woCustomerObservations)
      .where(and(eq(woCustomerObservations.tenantId, tenantId), eq(woCustomerObservations.id, id)))
      .limit(1);
    return row ? this.mapToEntity(row) : null;
  }

  async listByCustomer(tenantId: string, customerId: string): Promise<CustomerObservation[]> {
    const rows = await db
      .select()
      .from(woCustomerObservations)
      .where(and(
        eq(woCustomerObservations.tenantId, tenantId),
        eq(woCustomerObservations.customerId, customerId),
      ))
      .orderBy(desc(woCustomerObservations.createdAt));
    return rows.map((r) => this.mapToEntity(r));
  }

  async delete(tenantId: string, id: string): Promise<void> {
    await db.delete(woCustomerObservations)
      .where(and(eq(woCustomerObservations.tenantId, tenantId), eq(woCustomerObservations.id, id)));
  }

  private mapToEntity(row: typeof woCustomerObservations.$inferSelect): CustomerObservation {
    return {
      id:           row.id,
      tenantId:     row.tenantId,
      customerId:   row.customerId,
      observation:  row.observation,
      fileAssetId:  row.fileAssetId,
      createdBy:    row.createdBy,
      createdAt:    row.createdAt.toISOString(),
    };
  }
}

export const customerObservationRepository = new CustomerObservationRepository();
