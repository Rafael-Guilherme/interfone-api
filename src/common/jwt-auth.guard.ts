import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

/** Exige `Authorization: Bearer <access>` e injeta `req.user = { userId }`. */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const header: string = req.headers?.authorization ?? '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) {
      throw new UnauthorizedException('Token ausente.');
    }
    try {
      const payload = await this.jwt.verifyAsync(token);
      req.user = { userId: payload.sub, email: payload.email };
      return true;
    } catch {
      throw new UnauthorizedException('Token inválido.');
    }
  }
}

export const CurrentUserId = createParamDecorator(
  (_data, ctx: ExecutionContext): string => ctx.switchToHttp().getRequest().user.userId,
);
