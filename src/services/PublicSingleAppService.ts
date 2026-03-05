import { PublicSingleApp } from '../domain/entities/PublicSingleApp';
import { PublicSingleAppResponse } from '../domain/entities/PublicSingleAppResponse';
import {
  CreatePublicSingleAppDTO,
  UpdatePublicSingleAppDTO,
  SubmitResponseDTO,
  ReviseResponseDTO,
  UpdateResponseStatusDTO,
  ListResponsesParams,
} from '../dto/request/PublicSingleAppDTO';
import { IPublicSingleAppRepository } from '../repositories/interfaces/IPublicSingleAppRepository';
import { PublicSingleAppRepository } from '../repositories/PublicSingleAppRepository';
import { PaginatedResult } from '../shared/types';
import { NotFoundError, ConflictError } from '../shared/errors/AppError';
import { flatDiff } from '../shared/utils/flatDiff';

export class PublicSingleAppService {
  private repository: IPublicSingleAppRepository;

  constructor(repository?: IPublicSingleAppRepository) {
    this.repository = repository ?? new PublicSingleAppRepository();
  }

  // ============================================================
  // APPS
  // ============================================================

  async createApp(data: CreatePublicSingleAppDTO, createdBy?: string): Promise<PublicSingleApp> {
    const existing = await this.repository.getAppBySlug(data.slug);
    if (existing) {
      throw new ConflictError(`App with slug "${data.slug}" already exists`);
    }
    return this.repository.createApp(data, createdBy);
  }

  async getAppBySlug(slug: string): Promise<PublicSingleApp> {
    const app = await this.repository.getAppBySlug(slug);
    if (!app) {
      throw new NotFoundError(`App "${slug}" not found`);
    }
    return app;
  }

  async listApps(status?: string): Promise<PublicSingleApp[]> {
    return this.repository.listApps(status);
  }

  async updateApp(slug: string, data: UpdatePublicSingleAppDTO): Promise<PublicSingleApp> {
    await this.getAppBySlug(slug); // validates existence
    return this.repository.updateApp(slug, data);
  }

  async archiveApp(slug: string): Promise<void> {
    await this.getAppBySlug(slug);
    await this.repository.archiveApp(slug);
  }

  // ============================================================
  // RESPONSES
  // ============================================================

  async submitResponse(slug: string, data: SubmitResponseDTO, createdBy?: string): Promise<PublicSingleAppResponse> {
    const app = await this.getAppBySlug(slug);
    return this.repository.createResponse(app.id, data, createdBy);
  }

  async reviseResponse(
    slug: string,
    groupId: string,
    data: ReviseResponseDTO,
  ): Promise<PublicSingleAppResponse> {
    const app = await this.getAppBySlug(slug);

    const current = await this.repository.getLatestResponse(groupId);
    if (!current || current.appId !== app.id) {
      throw new NotFoundError(`Response group "${groupId}" not found for app "${slug}"`);
    }

    const changesFromPrevious = flatDiff(current.formData, data.formData);

    return this.repository.reviseResponse(groupId, {
      ...data,
      appId: app.id,
      nextVersion: current.responseVersion + 1,
      changesFromPrevious,
    });
  }

  async getLatestResponse(slug: string, groupId: string): Promise<PublicSingleAppResponse> {
    const app = await this.getAppBySlug(slug);
    const response = await this.repository.getLatestResponse(groupId);
    if (!response || response.appId !== app.id) {
      throw new NotFoundError(`Response group "${groupId}" not found`);
    }
    return response;
  }

  async getResponseHistory(slug: string, groupId: string): Promise<PublicSingleAppResponse[]> {
    const app = await this.getAppBySlug(slug);
    const history = await this.repository.getResponseHistory(groupId);
    if (history.length === 0 || history[0].appId !== app.id) {
      throw new NotFoundError(`Response group "${groupId}" not found`);
    }
    return history;
  }

  async getResponseByVersion(slug: string, groupId: string, version: number): Promise<PublicSingleAppResponse> {
    const app = await this.getAppBySlug(slug);
    const response = await this.repository.getResponseByVersion(groupId, version);
    if (!response || response.appId !== app.id) {
      throw new NotFoundError(`Response group "${groupId}" version ${version} not found`);
    }
    return response;
  }

  async listLatestResponses(slug: string, params: ListResponsesParams): Promise<PaginatedResult<PublicSingleAppResponse>> {
    const app = await this.getAppBySlug(slug);
    return this.repository.listLatestResponses(app.id, params);
  }

  async updateResponseStatus(slug: string, groupId: string, data: UpdateResponseStatusDTO): Promise<PublicSingleAppResponse> {
    const app = await this.getAppBySlug(slug);
    const response = await this.repository.getLatestResponse(groupId);
    if (!response || response.appId !== app.id) {
      throw new NotFoundError(`Response group "${groupId}" not found`);
    }
    return this.repository.updateResponseStatus(groupId, data.status);
  }
}

export const publicSingleAppService = new PublicSingleAppService();
