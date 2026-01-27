import { Router, Request, Response } from 'express';

const router = Router();

interface HealthStatus {
  status: 'healthy' | 'unhealthy' | 'degraded';
  version: string;
  timestamp: string;
  uptime: number;
  environment: string;
  checks: {
    database: 'ok' | 'error';
    memory: 'ok' | 'warning' | 'critical';
  };
}

/**
 * GET /health
 * Basic health check for load balancers
 */
router.get('/', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'ok' });
});

/**
 * GET /health/ready
 * Readiness probe - returns 200 when app is ready to receive traffic
 */
router.get('/ready', async (_req: Request, res: Response) => {
  try {
    // Add database connectivity check here when needed
    const isReady = true;

    if (isReady) {
      res.status(200).json({ status: 'ready' });
    } else {
      res.status(503).json({ status: 'not ready' });
    }
  } catch {
    res.status(503).json({ status: 'not ready' });
  }
});

/**
 * GET /health/live
 * Liveness probe - returns 200 if app is alive
 */
router.get('/live', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'alive' });
});

/**
 * GET /health/details
 * Detailed health status (protected in production)
 */
router.get('/details', (_req: Request, res: Response) => {
  const memoryUsage = process.memoryUsage();
  const usedMemoryMB = Math.round(memoryUsage.heapUsed / 1024 / 1024);
  const totalMemoryMB = Math.round(memoryUsage.heapTotal / 1024 / 1024);
  const memoryPercentage = Math.round((usedMemoryMB / totalMemoryMB) * 100);

  let memoryStatus: 'ok' | 'warning' | 'critical' = 'ok';
  if (memoryPercentage > 90) {
    memoryStatus = 'critical';
  } else if (memoryPercentage > 70) {
    memoryStatus = 'warning';
  }

  const health: HealthStatus = {
    status: memoryStatus === 'critical' ? 'degraded' : 'healthy',
    version: process.env.npm_package_version || '1.0.0',
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    environment: process.env.NODE_ENV || 'development',
    checks: {
      database: 'ok', // Will be updated when database connection is implemented
      memory: memoryStatus,
    },
  };

  res.status(health.status === 'healthy' ? 200 : 503).json(health);
});

export default router;
