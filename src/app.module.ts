import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PrismaModule } from './prisma/prisma.module';
import { LiveKitModule } from './livekit/livekit.module';
import { AuthModule } from './auth/auth.module';
import { DeliveryModule } from './delivery/delivery.module';
import { CallsModule } from './calls/calls.module';
import { HealthController } from './health.controller';

/**
 * App Interfone — respaldado no Postgres (Neon).
 *
 * Fase atual: auth (OTP) + delivery (QR) + calls (signaling DB-backed) + LiveKit.
 * Os demais módulos do plano (condomínios/perfis/reservas/comunicados/admin) estão
 * organizados em `src/skeleton/` e entram aqui à medida que forem concluídos.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true }),
    JwtModule.registerAsync({
      global: true,
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        secret: cfg.get<string>('JWT_ACCESS_SECRET') ?? 'dev-secret-change-me',
        signOptions: { expiresIn: '7d' }, // dev: token longo simplifica o teste
      }),
    }),
    PrismaModule,
    LiveKitModule,
    AuthModule,
    DeliveryModule,
    CallsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
