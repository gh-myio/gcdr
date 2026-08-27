import {
  IInventoryProjectRepository,
  InventoryProjectRepository,
} from '../../repositories/inventory/InventoryProjectRepository';
import { CustomerRepository } from '../../repositories/CustomerRepository';
import { ICustomerRepository } from '../../repositories/interfaces/ICustomerRepository';
import { CreateProjectDTO, UpdateProjectDTO, PaginationQuery } from '../../dto/request/InventoryDTO';
import { InvPaginatedResponse, InvProjectResponse } from '../../dto/response/InventoryResponseDTO';
import { AppError, ConflictError, NotFoundError, ValidationError } from '../../shared/errors/AppError';

// =============================================================================
// RFC-0061 M9 — Projetos. Business rules on top of inv_projects:
//   - `customerId` is optional; when present it must reference an existing
//     customer in the same tenant (the source's `clients` map onto GCDR
//     customers — no new clients table).
//   - Delete is guarded by the controller's confirmation token (S3); FK
//     RESTRICT from inv_purchase_orders / inv_expedition_orders surfaces as a
//     friendly 409 instead of a raw 23503.
// =============================================================================

export class InventoryProjectService {
  private projectRepository: IInventoryProjectRepository;
  private customerRepository: ICustomerRepository;

  constructor(
    projectRepo?: IInventoryProjectRepository,
    customerRepo?: ICustomerRepository,
  ) {
    this.projectRepository = projectRepo || new InventoryProjectRepository();
    this.customerRepository = customerRepo || new CustomerRepository();
  }

  async listProjects(
    tenantId: string,
    query: PaginationQuery,
  ): Promise<InvPaginatedResponse<InvProjectResponse>> {
    const { page, pageSize } = query;
    const { items, total } = await this.projectRepository.list(tenantId, { page, pageSize });

    return {
      items,
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async createProject(
    tenantId: string,
    data: CreateProjectDTO,
    createdBy?: string,
  ): Promise<InvProjectResponse> {
    await this.assertCustomerExists(tenantId, data.customerId);
    return this.projectRepository.create(tenantId, data, createdBy);
  }

  async updateProject(
    tenantId: string,
    id: string,
    data: UpdateProjectDTO,
    updatedBy?: string,
  ): Promise<InvProjectResponse> {
    await this.assertCustomerExists(tenantId, data.customerId);

    const updated = await this.projectRepository.update(tenantId, id, data, updatedBy);
    if (!updated) {
      throw new NotFoundError(`Project ${id} not found`);
    }
    return updated;
  }

  /**
   * Delete a project. The confirmation token was already enforced by the
   * controller guard (S3); here we only translate the FK RESTRICT from
   * inv_purchase_orders / inv_expedition_orders into a friendly 409.
   */
  async deleteProject(tenantId: string, id: string): Promise<void> {
    const deleted = await this.projectRepository
      .delete(tenantId, id)
      .catch((err: unknown) => this.mapDeleteError(err));
    if (!deleted) {
      throw new NotFoundError(`Project ${id} not found`);
    }
  }

  /** When a customerId is provided (non-null), it must exist in the tenant. */
  private async assertCustomerExists(
    tenantId: string,
    customerId: string | null | undefined,
  ): Promise<void> {
    if (customerId === undefined || customerId === null) return;

    const customer = await this.customerRepository.getById(tenantId, customerId);
    if (!customer) {
      throw new ValidationError(`Customer ${customerId} not found in tenant`);
    }
  }

  /**
   * Map the DB error from a blocked delete. Drizzle wraps the driver error in
   * a DrizzleQueryError: the real PostgresError (SQLSTATE on `.code`) lives on
   * `.cause`, while the top-level `.message` is a "Failed query: …" wrapper —
   * inspect both so the mapping fires regardless of wrapping.
   */
  private mapDeleteError(err: unknown): never {
    if (err instanceof AppError) throw err;

    const top = err as { message?: string; code?: string; cause?: { message?: string; code?: string } };
    const cause = top.cause ?? {};
    const code = cause.code ?? top.code;
    const message = `${top.message ?? String(err)}\n${cause.message ?? ''}`;

    if (code === '23503' || /foreign key/i.test(message)) {
      throw new ConflictError(
        'Projeto possui pedidos de compra ou expedições vinculados e não pode ser excluído',
      );
    }
    throw err;
  }
}

export const inventoryProjectService = new InventoryProjectService();
