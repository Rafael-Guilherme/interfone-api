import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { Auth } from '../../common/decorators/auth.decorator';
import { CondoScope } from '../../common/decorators/condo-scope.decorator';
import {
  CurrentProfile,
  ProfileContext,
} from '../../common/decorators/current-profile.decorator';
import { ActiveStatus } from '../../common/decorators/active-status.decorator';
import { CreateReservationDto, ListReservationsQueryDto } from './dto';
import { ReservationsService } from './reservations.service';

/**
 * Reservas são ação de morador ativo.
 *   @ActiveStatus → exige Profile com status === 'active' (o gate de aprovação).
 * O gestor, se também for morador de uma unidade, cai aqui como morador comum.
 */
@Auth()
@CondoScope()
@ActiveStatus()
@Controller('condominiums/:condoId/reservations')
export class ReservationsController {
  constructor(private readonly service: ReservationsService) {}

  @Get()
  list(
    @Param('condoId', ParseUUIDPipe) condoId: string,
    @Query() query: ListReservationsQueryDto,
    @CurrentProfile() profile: ProfileContext,
  ) {
    return this.service.listReservations(
      condoId,
      profile.id,
      query.scope ?? 'mine',
    );
  }

  @Post()
  create(
    @Param('condoId', ParseUUIDPipe) condoId: string,
    @Body() dto: CreateReservationDto,
    @CurrentProfile() profile: ProfileContext,
  ) {
    return this.service.createReservation(condoId, profile.id, dto);
  }

  @Delete(':reservationId')
  @HttpCode(204)
  async cancel(
    @Param('reservationId', ParseUUIDPipe) reservationId: string,
    @CurrentProfile() profile: ProfileContext,
  ) {
    await this.service.cancelReservation(reservationId, profile.id);
  }
}
