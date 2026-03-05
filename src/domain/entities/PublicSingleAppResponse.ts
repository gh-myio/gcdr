import { DiffEntry } from '../../shared/utils/flatDiff';

export type PublicSingleAppResponseStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'UNDER_REVIEW'
  | 'APPROVED'
  | 'REJECTED';

export interface SubmittedBy {
  firstName: string;
  lastName: string;
  email: string;
  company: string;
}

export interface PublicSingleAppResponse {
  id: string;
  appId: string;
  responseGroupId: string;
  responseVersion: number;
  isLatest: boolean;
  formData: Record<string, unknown>;
  submittedBy: SubmittedBy;
  changesFromPrevious: Record<string, DiffEntry> | null;
  changeNotes?: string;
  status: PublicSingleAppResponseStatus;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
}
