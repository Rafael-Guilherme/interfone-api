import {
  Injectable,
  InternalServerErrorException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomInt } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';

/**
 * Auth passwordless por OTP de e-mail (PLANEJAMENTO: sem senha).
 *
 * O envio real é feito pelo Resend (`MailService`). Fora de produção, quando
 * não há chave configurada, o código também volta em `devCode` para facilitar
 * o teste; em produção, um envio que falha derruba a requisição em vez de
 * responder "enviado" para um e-mail que nunca chegou.
 */
/** Tentativas erradas antes de queimar o código. */
const MAX_TENTATIVAS_OTP = 5;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly isProd = process.env.NODE_ENV === 'production';

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly mail: MailService,
  ) {}

  private hashCode(code: string) {
    const secret = process.env.JWT_ACCESS_SECRET ?? 'dev';
    return createHash('sha256').update(`${code}:${secret}`).digest('hex');
  }

  async requestOtp(email: string, name?: string) {
    // Usuário bloqueado/removido não recebe código — senão o bloqueio do admin
    // seria contornável só pedindo um OTP novo.
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing && existing.status !== 'active') {
      throw new UnauthorizedException('Esta conta está bloqueada.');
    }

    const user = await this.prisma.user.upsert({
      where: { email },
      update: name ? { name } : {},
      create: { email, name: name ?? 'Morador', status: 'active' },
    });

    // Invalida códigos anteriores: manter vários válidos ao mesmo tempo
    // multiplica as chances de acerto de quem estiver tentando adivinhar.
    await this.prisma.otpCode.updateMany({
      where: { destination: email, purpose: 'login', used_at: null },
      data: { used_at: new Date() },
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

    const envio = await this.mail.sendOtp(email, code);

    // Em produção não existe devCode; se o e-mail não saiu, o usuário ficaria
    // sem nenhuma forma de entrar — melhor falhar visivelmente.
    if (this.isProd && !envio.sent) {
      this.logger.error(`OTP não entregue para ${email}: ${envio.error}`);
      throw new InternalServerErrorException('Não foi possível enviar o código. Tente novamente.');
    }

    return {
      sent: envio.sent,
      ...(this.isProd ? {} : { devCode: code }),
    };
  }

  async verifyOtp(email: string, code: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) throw new UnauthorizedException('Código inválido.');
    if (user.status !== 'active') throw new UnauthorizedException('Esta conta está bloqueada.');

    const otp = await this.prisma.otpCode.findFirst({
      where: {
        destination: email,
        purpose: 'login',
        used_at: null,
        expires_at: { gt: new Date() },
      },
      orderBy: { created_at: 'desc' },
    });

    // Sem este limite, um código de 6 dígitos é adivinhável por força bruta:
    // são só 1 milhão de combinações e o código vale 10 minutos.
    if (otp && otp.attempts >= MAX_TENTATIVAS_OTP) {
      await this.prisma.otpCode.update({
        where: { id: otp.id },
        data: { used_at: new Date() }, // queima o código
      });
      this.logger.warn(`OTP bloqueado por excesso de tentativas: ${email}`);
      throw new UnauthorizedException('Muitas tentativas. Peça um novo código.');
    }

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
      user: { id: user.id, email: user.email, name: user.name, phone: user.phone, avatar_url: user.avatar_url },
      profiles: await this.profilesOf(userId),
    };
  }

  /** PATCH /me — atualiza nome/telefone/foto do usuário (perfil do síndico). */
  async updateMe(userId: string, dto: { name?: string; phone?: string; avatar_url?: string }) {
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
        ...(dto.avatar_url !== undefined ? { avatar_url: dto.avatar_url } : {}),
      },
    });
    return this.me(userId);
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
      // O app precisa disto para não oferecer ao sub-gestor botões que a API
      // vai recusar. Para `manager` a lista vem vazia no banco, mas ele tem
      // tudo — o cliente trata `role === 'manager'` como acesso total.
      permissions: p.permissions,
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
