import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { PrismaModule } from './prisma/prisma.module';
import { MailModule } from './mail/mail.module';
import { LiveKitModule } from './livekit/livekit.module';
import { AuthModule } from './auth/auth.module';
import { CondominiumsModule } from './condominiums/condominiums.module';
import { AnnouncementsModule } from './announcements/announcements.module';
import { CommonAreasModule } from './common-areas/common-areas.module';
import { QrCodesModule } from './qrcodes/qrcodes.module';
import { ResidentModule } from './resident/resident.module';
import { DeliveryModule } from './delivery/delivery.module';
import { CallsModule } from './calls/calls.module';
import { AdminModule } from './admin/admin.module';
import { InternalContactsModule } from './internal-contacts/internal-contacts.module';
import { PackagesModule } from './packages/packages.module';
import { HealthController } from './health.controller';
import { RequestContextMiddleware } from './common/request-context.middleware';

/**
 * App Interfone — respaldado no Postgres (Neon).
 *
 * Fase atual: auth (OTP) + delivery (QR) + calls (signaling DB-backed) + LiveKit.
 * Os demais módulos do plano (condomínios/perfis/reservas/comunicados/admin) estão
 * organizados em `src/skeleton/` e entram aqui à medida que forem concluídos.
 */
/**
 * Segredo do JWT. Em produção, um valor ausente ou placeholder derruba o boot:
 * o antigo fallback silencioso ('dev-secret-change-me') significaria que
 * qualquer pessoa que lesse o código público forjaria token de qualquer morador.
 * Melhor não subir do que subir inseguro.
 */
function segredoJwt(cfg: ConfigService): string {
  const s = cfg.get<string>('JWT_ACCESS_SECRET');
  const fraco = !s || s.length < 32 || /troque|change-me|dev-secret|segredo/i.test(s);
  if (process.env.NODE_ENV === 'production' && fraco) {
    throw new Error(
      'JWT_ACCESS_SECRET ausente ou fraco em produção. Gere um com `openssl rand -base64 32`.',
    );
  }
  return s ?? 'dev-secret-change-me';
}

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true }),
    // Teto global contra força bruta e flood. Os endpoints de auth e os
    // públicos do QR são os alvos óbvios: OTP de 6 dígitos e envio de e-mail
    // (que custa dinheiro e pode ser usado para bombardear um endereço).
    ThrottlerModule.forRoot({
      throttlers: [
        { name: 'curto', ttl: 10_000, limit: 20 },
        { name: 'longo', ttl: 60_000, limit: 120 },
      ],
      // Escape hatch só para rodar a suíte local sem esbarrar no próprio teto.
      // Ignorado em produção de propósito: lá o limite nunca deve ser desligável.
      skipIf: () =>
        process.env.NODE_ENV !== 'production' && process.env.RATE_LIMIT_DISABLED === 'true',
    }),
    JwtModule.registerAsync({
      global: true,
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        secret: segredoJwt(cfg),
        signOptions: { expiresIn: '7d' }, // dev: token longo simplifica o teste
      }),
    }),
    PrismaModule,
    MailModule,
    LiveKitModule,
    AuthModule,
    CondominiumsModule,
    AnnouncementsModule,
    CommonAreasModule,
    QrCodesModule,
    ResidentModule,
    DeliveryModule,
    CallsModule,
    AdminModule,
    PackagesModule,
    InternalContactsModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule implements NestModule {
  // Antes dos guards, para que 401/403 já tenham request_id no log.
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}
