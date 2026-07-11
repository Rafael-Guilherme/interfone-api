import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomInt } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Auth passwordless por OTP de e-mail (PLANEJAMENTO: sem senha).
 *
 * Sem provedor de e-mail configurado (MAIL_API_KEY placeholder), o código é
 * logado no servidor e — só fora de produção — devolvido em `devCode` para
 * facilitar o teste no app. Em produção isso é removido e o envio vai por Brevo.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly isProd = process.env.NODE_ENV === 'production';

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  private hashCode(code: string) {
    const secret = process.env.JWT_ACCESS_SECRET ?? 'dev';
    return createHash('sha256').update(`${code}:${secret}`).digest('hex');
  }

  async requestOtp(email: string, name?: string) {
    const user = await this.prisma.user.upsert({
      where: { email },
      update: name ? { name } : {},
      create: { email, name: name ?? 'Morador', status: 'active' },
    });

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await this.prisma.otpCode.create({
      data: {
        user_id: user.id,
        destination: email,
        code_hash: this.hashCode(code),
        purpose: 'login',
        expires_at: new Date(Date.now() + 10 * 60_000),
      },
    });

    this.logger.log(`OTP para ${email}: ${code} (expira em 10 min)`);
    return { sent: true, ...(this.isProd ? {} : { devCode: code }) };
  }

  async verifyOtp(email: string, code: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) throw new UnauthorizedException('Código inválido.');

    const otp = await this.prisma.otpCode.findFirst({
      where: {
        destination: email,
        purpose: 'login',
        used_at: null,
        expires_at: { gt: new Date() },
      },
      orderBy: { created_at: 'desc' },
    });
    if (!otp || otp.code_hash !== this.hashCode(code)) {
      if (otp) {
        await this.prisma.otpCode.update({
          where: { id: otp.id },
          data: { attempts: { increment: 1 } },
        });
      }
      throw new UnauthorizedException('Código inválido ou expirado.');
    }

    await this.prisma.otpCode.update({ where: { id: otp.id }, data: { used_at: new Date() } });
    if (!user.email_verified_at) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { email_verified_at: new Date() },
      });
    }

    const access = await this.jwt.signAsync({ sub: user.id, email: user.email });
    return {
      access,
      user: { id: user.id, email: user.email, name: user.name },
      profiles: await this.profilesOf(user.id),
    };
  }

  /** GET /me — usuário + perfis (condo, papel, unidades) para o app. */
  async me(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();
    return {
      user: { id: user.id, email: user.email, name: user.name, avatar_url: user.avatar_url },
      profiles: await this.profilesOf(userId),
    };
  }

  private async profilesOf(userId: string) {
    const profiles = await this.prisma.profile.findMany({
      where: { user_id: userId },
      include: {
        condominium: { select: { id: true, name: true, slug: true } },
        unit_memberships: {
          include: { unit: { include: { block: { select: { name: true } } } } },
        },
      },
    });

    return profiles.map((p) => ({
      id: p.id,
      role: p.role,
      status: p.status,
      condominium: p.condominium,
      units: p.unit_memberships.map((m) => ({
        id: m.unit.id,
        number: m.unit.number,
        block: m.unit.block?.name ?? null,
        label: m.unit.block ? `Bloco ${m.unit.block.name} · ${m.unit.number}` : m.unit.number,
      })),
    }));
  }
}
