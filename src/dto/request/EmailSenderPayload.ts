/**
 * EMAIL_SENDER Payload Contract — TypeScript interfaces
 *
 * Define o shape de cada payload enviado ao serviço EMAIL_SENDER.
 * Produtores: ALARMS-API (alarmes), GCDR (usuários, relatórios, notificações, etc.)
 *
 * Referência: docs/EMAIL-SENDER-PAYLOAD-CONTRACT.md
 */

// =============================================================================
// Envelope base — presente em TODOS os tipos
// =============================================================================

export type EmailEventType =
  | 'ALARM_OPENED'
  | 'ALARM_CLOSED'
  | 'NEW_USER'
  | 'PASSWORD_RESET'
  | 'REPORT_READY'
  | 'RELEASE_NOTE'
  | 'NOTIFICATION'
  | 'INSIGHT';

export type EmailSenderSource = 'ALARMS-API' | 'GCDR';

interface EmailSenderEnvelope<T extends EmailEventType, D> {
  type: T;
  customerId: string;
  tenantId: string;
  sentBy: EmailSenderSource;
  sentAt: string; // ISO 8601
  data: D;
}

// =============================================================================
// Shared sub-types
// =============================================================================

interface PlatformRef {
  name: string;
  url: string;
}

interface CustomerRef {
  id: string;
  name: string;
}

interface UserRef {
  name: string;
  email: string;
}

// =============================================================================
// Per-type data shapes
// =============================================================================

// --- ALARM_OPENED / ALARM_CLOSED ---

interface AlarmDevice {
  name: string;
  value: string;
  status: 'online' | 'offline';
  timestamp: string; // "DD/MM/YYYY HH:mm:ss"
}

interface AlarmRule {
  name: string;
  description: string;
  condition: string;
  /** String formatada separada por vírgula — EMAIL_SENDER converte de alarmRecipients[] */
  emails: string;
  devices: AlarmDevice[];
}

interface AlarmData {
  platform: PlatformRef;
  customer: CustomerRef;
  summary: {
    rulesCount: number;
    devicesCount: number;
    alarmStatus: 'OPENED' | 'CLOSED';
  };
  gateway: {
    name: string;
    type: string;
  };
  rules: AlarmRule[];
}

// --- NEW_USER / PASSWORD_RESET ---

interface WelcomeData {
  platform: PlatformRef;
  customer: CustomerRef;
  user: UserRef;
  activation: {
    link: string;
    expiresAt: string; // "DD/MM/YYYY HH:mm:ss"
  };
}

// --- REPORT_READY ---

interface ReportItem {
  label: string;
  value: string;
}

interface ReportData {
  platform: PlatformRef;
  customer: CustomerRef;
  recipients: string[];
  report: {
    title: string;
    period: string;
    generatedAt: string;
  };
  summary: {
    totalAlarms: number;
    activeDevices: number;
  };
  items: ReportItem[];
}

// --- RELEASE_NOTE ---

interface ReleaseFormat {
  label: string;
  description: string;
}

interface ReleasePanel {
  name: string;
  deviceCount: string;
}

interface ReleaseStep {
  number: string;
  text: string;
}

interface ReleaseHighlight {
  label: string;
  value: string;
  description: string;
}

interface ReleaseNoteData {
  platform: PlatformRef;
  recipients: string[];
  version: string;
  period: string;
  moduleName: string;
  featureTitle: string;
  featureSubtitle: string;
  overviewText: string;
  highlightPanelLabel: string;
  highlightMetric: string;
  formats: ReleaseFormat[];
  panels?: ReleasePanel[];
  steps: ReleaseStep[];
  highlights?: ReleaseHighlight[];
}

// --- NOTIFICATION ---

export type NotificationLevel = 'INFO' | 'WARNING' | 'ERROR' | 'SUCCESS';

interface NotificationData {
  platform: PlatformRef;
  customer: CustomerRef;
  user: UserRef;
  notification: {
    title: string;
    body: string;
    level: NotificationLevel;
    actionLabel?: string;
    actionUrl?: string;
  };
}

// --- INSIGHT ---

export type MetricTrend = 'UP' | 'DOWN' | 'STABLE';

interface InsightMetric {
  label: string;
  value: string;
  unit: string;
  trend: MetricTrend;
}

interface InsightRecommendation {
  title: string;
  text: string;
}

interface InsightData {
  platform: PlatformRef;
  customer: CustomerRef;
  recipients: string[];
  insight: {
    title: string;
    period: string;
    summary: string;
  };
  metrics: InsightMetric[];
  recommendations: InsightRecommendation[];
}

// =============================================================================
// Payload types finais (discriminated union por `type`)
// =============================================================================

export type AlarmOpenedPayload  = EmailSenderEnvelope<'ALARM_OPENED',  AlarmData>;
export type AlarmClosedPayload  = EmailSenderEnvelope<'ALARM_CLOSED',  AlarmData>;
export type NewUserPayload      = EmailSenderEnvelope<'NEW_USER',      WelcomeData>;
export type PasswordResetPayload= EmailSenderEnvelope<'PASSWORD_RESET',WelcomeData>;
export type ReportReadyPayload  = EmailSenderEnvelope<'REPORT_READY',  ReportData>;
export type ReleaseNotePayload  = EmailSenderEnvelope<'RELEASE_NOTE',  ReleaseNoteData>;
export type NotificationPayload = EmailSenderEnvelope<'NOTIFICATION',  NotificationData>;
export type InsightPayload      = EmailSenderEnvelope<'INSIGHT',       InsightData>;

/** Union discriminada de todos os payloads — usar para validar/rotear no EMAIL_SENDER */
export type EmailSenderPayload =
  | AlarmOpenedPayload
  | AlarmClosedPayload
  | NewUserPayload
  | PasswordResetPayload
  | ReportReadyPayload
  | ReleaseNotePayload
  | NotificationPayload
  | InsightPayload;

// =============================================================================
// Type guard helper
// =============================================================================

export function isEmailSenderPayload(value: unknown): value is EmailSenderPayload {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj['type'] === 'string' &&
    typeof obj['customerId'] === 'string' &&
    typeof obj['tenantId'] === 'string' &&
    typeof obj['sentBy'] === 'string' &&
    typeof obj['sentAt'] === 'string' &&
    typeof obj['data'] === 'object' && obj['data'] !== null
  );
}
