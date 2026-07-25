import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';

/**
 * Foco: o ciclo de vida da SESSÃO e as barreiras do OTP.
 *
 * São as duas regras que, se quebrarem em silêncio, tiram todo mundo do app ou
 * deixam entrar quem não devia — e nenhuma das duas aparece num teste de tela.
 * Prisma entra mockado: o que se testa aqui é a decisão, não o SQL.
 */
describe('AuthService', () => {
  /** Banco de mentira com o mínimo que o serviço toca. */
  function fakePrisma(estado: {
    user?: any;
    otp?: any;
    refresh?: any;
  } = {}) {
    const db = {
      refreshTokens: [] as any[],
      criados: [] as any[],
    };

    return {
      db,
      client: {
        user: {
          findUnique: jest.fn().mockResolvedValue(estado.user ?? null),
          findFirst: jest.fn().mockResolvedValue(estado.user ?? null),
          upsert: jest.fn().mockResolvedValue(estado.user ?? { id: 'u1', email: 'ana@x.com', name: 'Ana' }),
          update: jest.fn().mockResolvedValue(estado.user),
          create: jest.fn().mockResolvedValue(estado.user),
        },
        otpCode: {
          findFirst: jest.fn().mockResolvedValue(estado.otp ?? null),
          create: jest.fn().mockResolvedValue({ id: 'o1' }),
          update: jest.fn().mockResolvedValue({}),
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
        refreshToken: {
          findUnique: jest.fn().mockResolvedValue(estado.refresh ?? null),
          create: jest.fn().mockImplementation(({ data }: any) => {
            db.criados.push(data);
            return Promise.resolve({ id: 'r1', ...data });
          }),
          update: jest.fn().mockResolvedValue({}),
          updateMany: jest.fn().mockResolvedValue({ count: 2 }),
          deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        profile: { findMany: jest.fn().mockResolvedValue([]) },
      } as any,
    };
  }

  const jwt = { signAsync: jest.fn().mockResolvedValue('jwt.de.mentira') } as any;
  const mail = { sendOtp: jest.fn().mockResolvedValue({ sent: true }) } as any;

  const ana = { id: 'u1', email: 'ana@x.com', name: 'Ana', status: 'active', email_verified_at: new Date() };

  beforeEach(() => jest.clearAllMocks());

  // ---------------------------------------------------------------- OTP

  describe('OTP', () => {
    it('recusa código de conta bloqueada antes de qualquer envio', async () => {
      const { client } = fakePrisma({ user: { ...ana, status: 'blocked' } });
      const svc = new AuthService(client, jwt, mail);

      await expect(svc.requestOtp('ana@x.com')).rejects.toBeInstanceOf(UnauthorizedException);
      // O e-mail não pode sair: senão o bloqueio do painel seria contornável
      // pedindo um código novo.
      expect(mail.sendOtp).not.toHaveBeenCalled();
    });

    it('queima o código depois de 5 tentativas erradas', async () => {
      const otp = { id: 'o1', code_hash: 'outro', attempts: 5, expires_at: new Date(Date.now() + 60_000) };
      const { client } = fakePrisma({ user: ana, otp });
      const svc = new AuthService(client, jwt, mail);

      await expect(svc.verifyOtp('ana@x.com', '123456')).rejects.toThrow(/Muitas tentativas/);
      // Queimar é o que impede a força bruta: 6 dígitos são só 1 milhão de
      // combinações, e o código vale 10 minutos.
      expect(client.otpCode.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ used_at: expect.any(Date) }) }),
      );
    });

    it('conta a tentativa quando o código está errado', async () => {
      const otp = { id: 'o1', code_hash: 'hash-de-outro-codigo', attempts: 0, expires_at: new Date(Date.now() + 60_000) };
      const { client } = fakePrisma({ user: ana, otp });
      const svc = new AuthService(client, jwt, mail);

      await expect(svc.verifyOtp('ana@x.com', '000000')).rejects.toBeInstanceOf(UnauthorizedException);
      expect(client.otpCode.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { attempts: { increment: 1 } } }),
      );
    });

    it('não vaza a existência da conta: e-mail desconhecido dá o mesmo erro', async () => {
      const { client } = fakePrisma({ user: null });
      const svc = new AuthService(client, jwt, mail);
      await expect(svc.verifyOtp('ninguem@x.com', '123456')).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  // ------------------------------------------------------------ SESSÃO

  describe('sessão', () => {
    it('login devolve access + refresh e grava só o HASH do refresh', async () => {
      const { client, db } = fakePrisma({
        user: ana,
        otp: { id: 'o1', code_hash: '', attempts: 0, expires_at: new Date(Date.now() + 60_000) },
      });
      // O hash do código é interno; reproduzimos pelo próprio serviço.
      const svc = new AuthService(client, jwt, mail);
      client.otpCode.findFirst.mockResolvedValue({
        id: 'o1',
        code_hash: (svc as any).hashCode('123456'),
        attempts: 0,
        expires_at: new Date(Date.now() + 60_000),
      });

      const sessao = await svc.verifyOtp('ana@x.com', '123456');

      expect(sessao.access).toBeTruthy();
      expect(sessao.refresh).toHaveLength(64);
      // O que vai para o banco não pode ser o token: um dump vazado não dá sessão.
      expect(db.criados[0].token_hash).not.toBe(sessao.refresh);
      expect(db.criados[0].token_hash).toHaveLength(64);
    });

    it('renovar rotaciona: revoga o antigo e emite um novo', async () => {
      const svc0 = new AuthService(fakePrisma().client, jwt, mail);
      const token = 'refresh-valido';
      const registro = {
        id: 'r1',
        user_id: 'u1',
        token_hash: (svc0 as any).hashCode(token),
        revoked_at: null,
        expires_at: new Date(Date.now() + 86_400_000),
        user: ana,
      };
      const { client } = fakePrisma({ refresh: registro });
      const svc = new AuthService(client, jwt, mail);

      const novo = await svc.refresh(token);

      expect(client.refreshToken.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'r1' }, data: { revoked_at: expect.any(Date) } }),
      );
      expect(novo.refresh).not.toBe(token);
    });

    it('refresh já usado derruba TODAS as sessões do usuário', async () => {
      const svc0 = new AuthService(fakePrisma().client, jwt, mail);
      const token = 'ja-usado';
      const { client } = fakePrisma({
        refresh: {
          id: 'r1',
          user_id: 'u1',
          token_hash: (svc0 as any).hashCode(token),
          revoked_at: new Date(), // já rotacionado
          expires_at: new Date(Date.now() + 86_400_000),
          user: ana,
        },
      });
      const svc = new AuthService(client, jwt, mail);

      await expect(svc.refresh(token)).rejects.toBeInstanceOf(UnauthorizedException);
      // Um token rotacionado que reaparece significa que existem duas cópias.
      // Como não dá para saber qual é a do dono, caem as duas.
      expect(client.refreshToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { user_id: 'u1', revoked_at: null } }),
      );
    });

    it('refresh vencido exige login novo (a janela de 7 dias parada)', async () => {
      const svc0 = new AuthService(fakePrisma().client, jwt, mail);
      const token = 'vencido';
      const { client } = fakePrisma({
        refresh: {
          id: 'r1',
          user_id: 'u1',
          token_hash: (svc0 as any).hashCode(token),
          revoked_at: null,
          expires_at: new Date(Date.now() - 1000),
          user: ana,
        },
      });
      const svc = new AuthService(client, jwt, mail);

      await expect(svc.refresh(token)).rejects.toThrow(/Entre novamente/);
      // Vencer não é roubo: as outras sessões do usuário continuam de pé.
      expect(client.refreshToken.updateMany).not.toHaveBeenCalled();
    });

    it('conta bloqueada não renova, mesmo com refresh válido', async () => {
      const svc0 = new AuthService(fakePrisma().client, jwt, mail);
      const token = 'valido';
      const { client } = fakePrisma({
        refresh: {
          id: 'r1',
          user_id: 'u1',
          token_hash: (svc0 as any).hashCode(token),
          revoked_at: null,
          expires_at: new Date(Date.now() + 86_400_000),
          user: { ...ana, status: 'blocked' },
        },
      });
      const svc = new AuthService(client, jwt, mail);
      await expect(svc.refresh(token)).rejects.toThrow(/bloqueada/);
    });

    it('refresh inventado é recusado sem tocar em nada', async () => {
      const { client } = fakePrisma({ refresh: null });
      const svc = new AuthService(client, jwt, mail);
      await expect(svc.refresh('inventado')).rejects.toBeInstanceOf(UnauthorizedException);
      expect(client.refreshToken.updateMany).not.toHaveBeenCalled();
    });

    it('logout APAGA o registro em vez de revogá-lo', async () => {
      const { client } = fakePrisma();
      const svc = new AuthService(client, jwt, mail);

      await svc.logout('meu-refresh');

      // Revogar marcaria o token como "usado indevidamente" e, num retry do
      // cliente depois do logout, derrubaria os OUTROS aparelhos do usuário.
      expect(client.refreshToken.deleteMany).toHaveBeenCalled();
      expect(client.refreshToken.updateMany).not.toHaveBeenCalled();
    });

    it('logout sem token não faz nada (e não explode)', async () => {
      const { client } = fakePrisma();
      const svc = new AuthService(client, jwt, mail);
      await expect(svc.logout(undefined)).resolves.toEqual({ ok: true });
      expect(client.refreshToken.deleteMany).not.toHaveBeenCalled();
    });
  });
});
