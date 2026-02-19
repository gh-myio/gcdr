// =============================================================================
// Request Monitor Middleware
// =============================================================================
// Captures request/response data in a circular buffer for the API Monitor UI.
// =============================================================================

import { Request, Response, NextFunction } from 'express';

export interface MonitorLogEntry {
  id: number;
  timestamp: string;
  method: string;
  path: string;
  route: string;
  statusCode: number;
  duration: number;
  requestSize: number;
  responseSize: number;
  userAgent?: string;
  ip?: string;
  tenantId?: string;
  userId?: string;
  error?: string;
}

const MAX_LOGS = 200;
const monitorLogs: MonitorLogEntry[] = [];
let logIdCounter = 0;
let isEnabled = true;
let pathFilters: string[] = [];

export function addMonitorLog(entry: Omit<MonitorLogEntry, 'id'>): void {
  logIdCounter++;
  monitorLogs.unshift({ id: logIdCounter, ...entry });
  if (monitorLogs.length > MAX_LOGS) {
    monitorLogs.pop();
  }
}

export function getMonitorLogs(): MonitorLogEntry[] {
  return monitorLogs;
}

export function clearMonitorLogs(): void {
  monitorLogs.length = 0;
}

export function setMonitorEnabled(enabled: boolean): void {
  isEnabled = enabled;
}

export function isMonitorEnabled(): boolean {
  return isEnabled;
}

export function setPathFilters(filters: string[]): void {
  pathFilters = filters;
}

export function getPathFilters(): string[] {
  return pathFilters;
}

/**
 * Express middleware that captures request/response metrics.
 * Must be mounted AFTER contextMiddleware to have access to req.context.
 */
export function requestMonitorMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (!isEnabled) {
    next();
    return;
  }

  const startTime = Date.now();
  const originalEnd = res.end;

  res.end = function (this: Response, ...args: any[]) {
    const duration = Date.now() - startTime;
    const routePath = req.route?.path || req.path;
    const fullRoute = req.baseUrl + routePath;

    // Filter: if pathFilters is set, only capture routes that match
    const shouldLog = pathFilters.length === 0 ||
      pathFilters.some(f => req.path.includes(f) || fullRoute.includes(f));

    // Exclude /admin/monitor to avoid self-logging loop
    if (shouldLog && !req.path.startsWith('/admin/monitor')) {
      addMonitorLog({
        timestamp: new Date().toISOString(),
        method: req.method,
        path: req.originalUrl || req.path,
        route: fullRoute,
        statusCode: res.statusCode,
        duration,
        requestSize: parseInt(req.headers['content-length'] || '0', 10),
        responseSize: parseInt(res.getHeader('content-length')?.toString() || '0', 10),
        userAgent: req.headers['user-agent'],
        ip: req.ip,
        tenantId: (req as any).context?.tenantId,
        userId: (req as any).context?.userId,
        error: res.statusCode >= 400 ? res.statusMessage : undefined,
      });
    }

    return (originalEnd as Function).apply(this, args);
  } as any;

  next();
}
