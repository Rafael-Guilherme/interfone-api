import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Exige que o usuário autenticado seja admin da plataforma (`User.is_super_admin`).
 * Usar SEMPRE depois do JwtAuthGuard, que popula `req.user`.
 *
 * A flag é consultada no banco a cada request de propósito: revogar um admin
 * precisa ter efeito imediato, sem esperar o JWT (7 dias) expirar.
 */
@Injectable()
export class SuperAdminGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const userId = req.user?.userId;
    if (!userId) throw new ForbiddenException('Não autenticado.');

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { is_super_admin: true, status: true },
    });
    if (!user?.is_super_admin || user.status !== 'active') {
      throw new ForbiddenException('Acesso restrito ao administrador da plataforma.');
    }
    return true;
  }
}
