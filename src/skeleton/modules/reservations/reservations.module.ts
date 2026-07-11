import { Module } from '@nestjs/common';
import { CommonAreasController } from './common-areas.controller';
import { ReservationsController } from './reservations.controller';
import { ReservationsService } from './reservations.service';

/**
 * Reservas de áreas comuns.
 *
 * Agrupa dois controllers sobre o mesmo agregado, separados por papel:
 *   - CommonAreasController  → gestor cria/edita/habilita áreas (③·6) + morador lista habilitadas
 *   - ReservationsController  → morador reserva/cancela; lista "minhas reservas" ou agenda (②·6)
 *
 * PrismaModule é @Global, então não precisa ser importado aqui.
 */
@Module({
  controllers: [CommonAreasController, ReservationsController],
  providers: [ReservationsService],
  exports: [ReservationsService],
})
export class ReservationsModule {}
