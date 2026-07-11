import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ThrottlerModule } from '@nestjs/throttler';

// Infra transversal
import { PrismaModule } from './common/prisma/prisma.module';
import { validateEnv } from './config/env.validation';

// Módulos de domínio
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { CondominiumsModule } from './modules/condominiums/condominiums.module';
import { ProfilesModule } from './modules/profiles/profiles.module';
import { QrCodesModule } from './modules/qrcodes/qrcodes.module';
import { ReservationsModule } from './modules/reservations/reservations.module';
import { AnnouncementsModule } from './modules/announcements/announcements.module';
import { CallsModule } from './modules/calls/calls.module';
import { DeliveryModule } from './modules/delivery/delivery.module';
import { AdminModule } from './modules/admin/admin.module';

/**
 * Raiz da aplicação.
 *
 * Ordem de raciocínio da composição:
 *   1. ConfigModule global + validação de env no boot (falha cedo se faltar segredo).
 *   2. PrismaModule global — um pool de conexão compartilhado por toda a app.
 *   3. EventEmitter — desacopla CallsService ↔ SignalingGateway (evita dep. circular).
 *   4. Throttler global — protege sobretudo a rota pública /q/:token do delivery.
 *   5. Módulos de domínio, na ordem de dependência do roadmap (auth → ... → delivery).
 *
 * Guards globais (Auth/CondoScope/etc.) NÃO são registrados aqui como APP_GUARD:
 * são aplicados por decorator em cada controller, porque o delivery é público e
 * um guard global de auth quebraria essa rota. Manter a decisão local é mais seguro.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv, // lança no boot se algum env obrigatório faltar
    }),

    PrismaModule, // @Global

    EventEmitterModule.forRoot(),

    // Rate limiting: 60 req/min por IP como teto padrão.
    // O DeliveryController aperta esse limite localmente com @Throttle.
    ThrottlerModule.forRoot([
      { ttl: 60_000, limit: 60 },
    ]),

    // --- domínio (ordem = dependência) ---
    AuthModule,
    UsersModule,
    CondominiumsModule,
    ProfilesModule,
    QrCodesModule,
    ReservationsModule,
    AnnouncementsModule,
    CallsModule,
    DeliveryModule, // importa CallsModule
    AdminModule,
  ],
})
export class AppModule {}
