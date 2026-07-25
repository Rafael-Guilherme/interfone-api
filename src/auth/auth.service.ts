import {
  Injectable,
  InternalServerErrorException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { OAuth2Client } from 'google-auth-library';
import { createHash, randomBytes, randomInt } from 'node:crypto';
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

/**
 * Sessão em duas peças, com janela deslizante:
 *
 *   access  — JWT curto, vai em toda requisição. Expirou, o app troca sozinho.
 *   refresh — opaco e longo, guardado no aparelho e (em hash) no banco.
 *             Cada uso emite um novo e revoga o anterior (rotação), então quem
 *             usa o app continua logado indefinidamente; parou de usar por
 *             REFRESH_TTL_DIAS, precisa entrar de novo.
 *
 * O access é curto de propósito: ele não pode ser revogado (é assinado, não
 * consultado), então o estrago de um token vazado dura o tempo dele. Quem
 * revoga é o refresh, que passa pelo banco.
 */
const ACCESS_TTL = process.env.JWT_ACCESS_TTL ?? '30m';
const REFRESH_TTL_DIAS = Number(process.env.REFRESH_TTL_DIAS ?? 7);

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly isProd = process.env.NODE_ENV === 'production';
  // Sem clientId fixo: a verificação valida o `aud` contra a lista de audiences
  // (os client IDs de iOS/Android), como manda o fluxo de ID token nativo.
  private readonly googleClient = new OAuth2Client();

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly mail: MailService,
  ) {}

  private hashCode(code: string) {
    const secret = process.env.JWT_ACCESS_SECRET ?? 'dev';
    return createHash('sha256').update(`${code}:${secret}`).digest('hex');
  }

  /**
   * Emite o par access+refresh e devolve a sessão no formato que o app espera.
   *
   * O refresh é opaco (bytes aleatórios), não um JWT: assim ele só vale se
   * estiver no banco, e revogar é apagar uma linha. No banco fica só o hash —
   * um vazamento do dump não dá sessão a ninguém, mesma lógica do OTP.
   */
  private async emitirSessao(user: { id: string; email: string; name: string }) {
    const access = await this.jwt.signAsync(
      { sub: user.id, email: user.email },
      { expiresIn: ACCESS_TTL },
    );
    const refresh = randomBytes(48).toString('base64url');
    await this.prisma.refreshToken.create({
      data: {
        user_id: user.id,
        token_hash: this.hashCode(refresh),
        expires_at: new Date(Date.now() + REFRESH_TTL_DIAS * 86_400_000),
      },
    });

    return {
      access,
      refresh,
      user: { id: user.id, email: user.email, name: user.name },
      profiles: await this.profilesOf(user.id),
    };
  }

  /**
   * Troca o refresh por um par novo (rotação) — é isto que mantém logado quem
   * usa o app: cada renovação empurra o prazo por mais REFRESH_TTL_DIAS.
   *
   * Um refresh já usado nunca é aceito de novo. Se aparecer, ou é uma repetição
   * de requisição, ou alguém copiou o token do aparelho: nos dois casos
   * derrubamos TODAS as sessões do usuário, porque não há como distinguir o
   * dono do impostor — os dois têm o mesmo token.
   */
  async refresh(token: string) {
    if (!token) throw new UnauthorizedException('Sessão inválida.');
    const registro = await this.prisma.refreshToken.findUnique({
      where: { token_hash: this.hashCode(token) },
      include: { user: true },
    });

    if (!registro) throw new UnauthorizedException('Sessão inválida.');

    if (registro.revoked_at) {
      await this.prisma.refreshToken.updateMany({
        where: { user_id: registro.user_id, revoked_at: null },
        data: { revoked_at: new Date() },
      });
      this.logger.warn(`refresh reutilizado — sessões do usuário ${registro.user_id} revogadas`);
      throw new UnauthorizedException('Sessão expirada. Entre novamente.');
    }

    if (registro.expires_at < new Date()) {
      throw new UnauthorizedException('Sessão expirada. Entre novamente.');
    }
    if (registro.user.status !== 'active') {
      throw new UnauthorizedException('Esta conta está bloqueada.');
    }

    await this.prisma.refreshToken.update({
      where: { id: registro.id },
      data: { revoked_at: new Date() },
    });
    // Aproveita a visita para limpar o que já venceu deste usuário; sem isso a
    // tabela só cresce, um registro por renovação.
    await this.prisma.refreshToken.deleteMany({
      where: { user_id: registro.user_id, expires_at: { lt: new Date() } },
    });

    return this.emitirSessao(registro.user);
  }

  /**
   * Logout: encerra só a sessão deste aparelho — os outros seguem válidos.
   *
   * Apaga a linha em vez de marcá-la como revogada, e a diferença importa: um
   * refresh *revogado* que reaparece é tratado como roubo e derruba todas as
   * sessões do usuário. Sair do app não é roubo — se o registro ficasse
   * revogado, um retry do cliente depois do logout expulsaria a pessoa dos
   * outros aparelhos dela. Apagado, ele vira "não existe" e leva só um 401.
   */
  async logout(token?: string) {
    if (!token) return { ok: true };
    await this.prisma.refreshToken.deleteMany({ where: { token_hash: this.hashCode(token) } });
    return { ok: true };
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

    return this.emitirSessao(user);
  }

  /**
   * Login/registro com Google (SÓ no app — o painel web usa OTP).
   *
   * O app faz o sign-in nativo e manda o `id_token`; aqui a assinatura, a
   * expiração e o `aud` (client IDs iOS/Android) são verificados contra as
   * chaves públicas do Google. Depois é o mesmo acha-ou-cria da referência
   * `rota-api`: existe por google_id/e-mail → loga; senão cria a conta. A
   * sessão devolvida tem o MESMO formato do `verifyOtp` (o app não distingue).
   */
  async loginWithGoogle(idToken: string) {
    const payload = await this.verificarTokenGoogle(idToken);
    const email = payload.email?.toLowerCase();
    if (!email) throw new UnauthorizedException('Conta Google sem e-mail.');

    // Casa por google_id (login recorrente) ou por e-mail (vincula uma conta que
    // já existia via OTP ao Google).
    let user = await this.prisma.user.findFirst({
      where: { OR: [{ google_id: payload.sub }, { email }] },
    });

    if (user) {
      if (user.status !== 'active') throw new UnauthorizedException('Esta conta está bloqueada.');
      // Completa o que faltar sem sobrescrever o que o usuário já definiu.
      const data: {
        google_id?: string;
        email_verified_at?: Date;
        avatar_url?: string;
      } = {};
      if (!user.google_id) data.google_id = payload.sub;
      if (!user.email_verified_at && payload.email_verified) data.email_verified_at = new Date();
      if (!user.avatar_url && payload.picture) data.avatar_url = payload.picture;
      if (Object.keys(data).length) {
        user = await this.prisma.user.update({ where: { id: user.id }, data });
      }
    } else {
      user = await this.prisma.user.create({
        data: {
          email,
          google_id: payload.sub,
          name: payload.name?.trim() || email.split('@')[0],
          avatar_url: payload.picture ?? null,
          // O Google já verificou o e-mail; não precisa de OTP.
          email_verified_at: payload.email_verified ? new Date() : null,
        },
      });
      this.logger.log(`Novo usuário via Google: ${email}`);
    }

    return this.emitirSessao(user);
  }

  /** Verifica o id_token do Google e devolve o payload já validado. */
  private async verificarTokenGoogle(idToken: string) {
    const audience = [
      process.env.GOOGLE_CLIENT_ID_IOS,
      process.env.GOOGLE_CLIENT_ID_ANDROID,
    ].filter((v): v is string => !!v && !v.startsWith('xxxx'));

    if (audience.length === 0) {
      throw new InternalServerErrorException('Login com Google não está configurado no servidor.');
    }

    let ticket;
    try {
      ticket = await this.googleClient.verifyIdToken({ idToken, audience });
    } catch (e) {
      this.logger.warn(`Falha ao verificar token Google: ${(e as Error).message}`);
      throw new UnauthorizedException('Não foi possível validar o login com Google.');
    }
    const payload = ticket.getPayload();
    if (!payload?.sub) throw new UnauthorizedException('Token do Google inválido.');
    return payload;
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
