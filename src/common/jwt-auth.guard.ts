import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Exige `Authorization: Bearer <access>` e injeta `req.user = { userId }`.
 *
 * Confere o status do usuário no banco a cada request: sem isso, bloquear
 * alguém pelo painel não teria efeito nenhum até o JWT (7 dias) expirar — o
 * token continuaria valendo. É uma leitura por PK, barata; quando os refresh
 * tokens curtos existirem dá para reavaliar.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const header: string = req.headers?.authorization ?? '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) {
      throw new UnauthorizedException('Token ausente.');
    }

    let payload: { sub: string; email?: string };
    try {
      payload = await this.jwt.verifyAsync(token);
    } catch {
      throw new UnauthorizedException('Token inválido.');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { status: true },
    });
    if (!user || user.status !== 'active') {
      throw new UnauthorizedException('Conta bloqueada ou inexistente.');
    }

    req.user = { userId: payload.sub, email: payload.email };
    return true;
  }
}

export const CurrentUserId = createParamDecorator(
  (_data, ctx: ExecutionContext): string => ctx.switchToHttp().getRequest().user.userId,
);
