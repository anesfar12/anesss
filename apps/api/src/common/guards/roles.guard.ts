// ═══════════════════════════════════════════════════════════════════════════
// LUXE POS v5.1 — RolesGuard
// ═══════════════════════════════════════════════════════════════════════════

import {
  Injectable, CanActivate, ExecutionContext, ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLE_LEVELS } from '../types/auth.types';
import type { JwtPayload } from '../types/auth.types';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>('roles', [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles?.length) return true;

    const request = context.switchToHttp().getRequest<{ user: JwtPayload }>();
    const user = request.user;

    if (!user) throw new ForbiddenException('No authenticated user');

    const userLevel = ROLE_LEVELS[user.role] ?? 0;
    const hasAccess = requiredRoles.some(
      (role) => userLevel >= (ROLE_LEVELS[role] ?? 0),
    );

    if (!hasAccess) {
      throw new ForbiddenException(
        `Role '${user.role}' insufficient — requires one of: ${requiredRoles.join(', ')}`
      );
    }

    return true;
  }
}
