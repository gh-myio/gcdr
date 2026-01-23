import { Request, Response, NextFunction } from 'express';
import { UnauthorizedError } from '../shared/errors/AppError';
import { decodeJWT, JWTUser } from './context';

/**
 * Authentication middleware - requires valid JWT token
 */
export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers['authorization'];

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    next(new UnauthorizedError('Token de acesso não fornecido'));
    return;
  }

  const token = authHeader.slice(7);
  const user = decodeJWT(token);

  if (!user) {
    next(new UnauthorizedError('Token de acesso inválido ou expirado'));
    return;
  }

  req.user = user;
  req.context.tenantId = user.tenant_id;
  req.context.userId = user.sub;

  next();
}

/**
 * Optional authentication - extracts user if token present, but doesn't fail if missing
 */
export function optionalAuthMiddleware(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers['authorization'];

  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    const user = decodeJWT(token);

    if (user) {
      req.user = user;
      req.context.tenantId = user.tenant_id;
      req.context.userId = user.sub;
    }
  }

  next();
}

/**
 * Require specific roles
 */
export function requireRoles(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(new UnauthorizedError('Autenticação necessária'));
      return;
    }

    const hasRole = roles.some(role => req.user!.roles.includes(role));

    if (!hasRole) {
      next(new UnauthorizedError(`Acesso negado. Roles necessárias: ${roles.join(', ')}`));
      return;
    }

    next();
  };
}
