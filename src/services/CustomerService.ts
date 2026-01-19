import { Customer } from '../domain/entities/Customer';
import {
  CreateCustomerDTO,
  UpdateCustomerDTO,
  MoveCustomerDTO,
  ListCustomersParams,
  GetDescendantsParams,
} from '../dto/request/CustomerDTO';
import { CustomerRepository } from '../repositories/CustomerRepository';
import { CustomerTreeNode, ICustomerRepository } from '../repositories/interfaces/ICustomerRepository';
import { eventService } from '../infrastructure/events/EventService';
import { EventType } from '../shared/events/eventTypes';
import { PaginatedResult } from '../shared/types';
import { NotFoundError, ConflictError, ValidationError } from '../shared/errors/AppError';

export class CustomerService {
  private repository: ICustomerRepository;

  constructor(repository?: ICustomerRepository) {
    this.repository = repository || new CustomerRepository();
  }

  async create(tenantId: string, data: CreateCustomerDTO, userId: string): Promise<Customer> {
    // Check for duplicate code
    if (data.code) {
      const existing = await this.repository.getByCode(tenantId, data.code);
      if (existing) {
        throw new ConflictError(`Customer with code ${data.code} already exists`);
      }
    }

    const customer = await this.repository.create(tenantId, data, userId);

    // Publish event
    await eventService.publish(EventType.CUSTOMER_CREATED, {
      tenantId,
      entityType: 'customer',
      entityId: customer.id,
      action: 'created',
      data: {
        name: customer.name,
        type: customer.type,
        parentCustomerId: customer.parentCustomerId,
      },
      actor: { userId, type: 'user' },
    });

    return customer;
  }

  async getById(tenantId: string, id: string): Promise<Customer> {
    const customer = await this.repository.getById(tenantId, id);
    if (!customer) {
      throw new NotFoundError(`Customer ${id} not found`);
    }
    return customer;
  }

  async update(tenantId: string, id: string, data: UpdateCustomerDTO, userId: string): Promise<Customer> {
    // Check if customer exists
    await this.getById(tenantId, id);

    // Check for duplicate code if updating
    if (data.code) {
      const existing = await this.repository.getByCode(tenantId, data.code);
      if (existing && existing.id !== id) {
        throw new ConflictError(`Customer with code ${data.code} already exists`);
      }
    }

    const customer = await this.repository.update(tenantId, id, data, userId);

    // Publish event
    await eventService.publish(EventType.CUSTOMER_UPDATED, {
      tenantId,
      entityType: 'customer',
      entityId: customer.id,
      action: 'updated',
      data: { updatedFields: Object.keys(data) },
      actor: { userId, type: 'user' },
    });

    return customer;
  }

  async delete(tenantId: string, id: string, userId: string): Promise<void> {
    const customer = await this.getById(tenantId, id);

    // Check for children
    const children = await this.repository.getChildren(tenantId, id);
    if (children.length > 0) {
      throw new ValidationError('Cannot delete customer with children. Move or delete children first.');
    }

    await this.repository.delete(tenantId, id);

    // Publish event
    await eventService.publish(EventType.CUSTOMER_DELETED, {
      tenantId,
      entityType: 'customer',
      entityId: id,
      action: 'deleted',
      data: { name: customer.name },
      actor: { userId, type: 'user' },
    });
  }

  async list(tenantId: string, params: ListCustomersParams): Promise<PaginatedResult<Customer>> {
    return this.repository.listWithFilters(tenantId, params);
  }

  async getChildren(tenantId: string, customerId: string): Promise<Customer[]> {
    // Validate customer exists
    await this.getById(tenantId, customerId);
    return this.repository.getChildren(tenantId, customerId);
  }

  async getDescendants(
    tenantId: string,
    customerId: string,
    params?: GetDescendantsParams
  ): Promise<Customer[]> {
    // Validate customer exists
    await this.getById(tenantId, customerId);
    return this.repository.getDescendants(tenantId, customerId, params?.maxDepth);
  }

  async getAncestors(tenantId: string, customerId: string): Promise<Customer[]> {
    return this.repository.getAncestors(tenantId, customerId);
  }

  async getTree(tenantId: string, rootCustomerId?: string): Promise<CustomerTreeNode[]> {
    if (rootCustomerId) {
      await this.getById(tenantId, rootCustomerId);
    }
    return this.repository.getTree(tenantId, rootCustomerId);
  }

  async move(tenantId: string, customerId: string, data: MoveCustomerDTO, userId: string): Promise<Customer> {
    const customer = await this.getById(tenantId, customerId);
    const oldParentId = customer.parentCustomerId;

    // Validate new parent if provided
    if (data.newParentCustomerId) {
      const newParent = await this.repository.getById(tenantId, data.newParentCustomerId);
      if (!newParent) {
        throw new NotFoundError(`New parent customer ${data.newParentCustomerId} not found`);
      }

      // Check for circular reference - can't move to self or descendant
      if (data.newParentCustomerId === customerId) {
        throw new ValidationError('Cannot move customer to itself');
      }

      const descendants = await this.repository.getDescendants(tenantId, customerId);
      const descendantIds = new Set(descendants.map((d) => d.id));
      if (descendantIds.has(data.newParentCustomerId)) {
        throw new ValidationError('Cannot move customer under its own descendant');
      }
    }

    const movedCustomer = await this.repository.move(tenantId, customerId, data.newParentCustomerId, userId);

    // Publish event
    await eventService.publish(EventType.CUSTOMER_MOVED, {
      tenantId,
      entityType: 'customer',
      entityId: customerId,
      action: 'moved',
      data: {
        oldParentId,
        newParentId: data.newParentCustomerId,
      },
      actor: { userId, type: 'user' },
    });

    return movedCustomer;
  }

  async getRootCustomers(tenantId: string): Promise<Customer[]> {
    return this.repository.getChildren(tenantId, null);
  }
}

export const customerService = new CustomerService();
