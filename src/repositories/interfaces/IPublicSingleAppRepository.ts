import { PublicSingleApp } from '../../domain/entities/PublicSingleApp';
import { PublicSingleAppResponse } from '../../domain/entities/PublicSingleAppResponse';
import {
  CreatePublicSingleAppDTO,
  UpdatePublicSingleAppDTO,
  SubmitResponseDTO,
  ReviseResponseDTO,
  ListResponsesParams,
} from '../../dto/request/PublicSingleAppDTO';
import { DiffEntry } from '../../shared/utils/flatDiff';
import { PaginatedResult } from '../../shared/types';

export interface ReviseResponseInput extends ReviseResponseDTO {
  appId: string;
  nextVersion: number;
  changesFromPrevious: Record<string, DiffEntry>;
}

export interface IPublicSingleAppRepository {
  // ── Apps ────────────────────────────────────────────────────────
  createApp(data: CreatePublicSingleAppDTO, createdBy?: string): Promise<PublicSingleApp>;
  getAppBySlug(slug: string): Promise<PublicSingleApp | null>;
  getAppById(id: string): Promise<PublicSingleApp | null>;
  listApps(status?: string): Promise<PublicSingleApp[]>;
  updateApp(slug: string, data: UpdatePublicSingleAppDTO): Promise<PublicSingleApp>;
  archiveApp(slug: string): Promise<void>;

  // ── Responses ───────────────────────────────────────────────────
  createResponse(appId: string, data: SubmitResponseDTO, createdBy?: string): Promise<PublicSingleAppResponse>;
  reviseResponse(groupId: string, input: ReviseResponseInput): Promise<PublicSingleAppResponse>;
  getLatestResponse(groupId: string): Promise<PublicSingleAppResponse | null>;
  getResponseHistory(groupId: string): Promise<PublicSingleAppResponse[]>;
  getResponseByVersion(groupId: string, version: number): Promise<PublicSingleAppResponse | null>;
  listLatestResponses(appId: string, params: ListResponsesParams): Promise<PaginatedResult<PublicSingleAppResponse>>;
  updateResponseStatus(groupId: string, status: string): Promise<PublicSingleAppResponse>;
}
