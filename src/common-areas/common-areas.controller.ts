import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { CommonAreasService } from './common-areas.service';
import { CreateCommonAreaDto, DecideReservationDto, ManagementReservationDto, SetAreaBlockDto, UpdateCommonAreaDto } from './dto';
import { CurrentUserId, JwtAuthGuard } from '../common/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('condominiums/:condoId/common-areas')
export class CommonAreasController {
  constructor(private readonly service: CommonAreasService) {}

  @Get()
  list(@CurrentUserId() userId: string, @Param('condoId', ParseUUIDPipe) condoId: string) {
    return this.service.list(userId, condoId);
  }

  @Post()
  create(@CurrentUserId() userId: string, @Param('condoId', ParseUUIDPipe) condoId: string, @Body() dto: CreateCommonAreaDto) {
    return this.service.create(userId, condoId, dto);
  }

  @Patch(':areaId')
  update(
    @CurrentUserId() userId: string,
    @Param('condoId', ParseUUIDPipe) condoId: string,
    @Param('areaId', ParseUUIDPipe) areaId: string,
    @Body() dto: UpdateCommonAreaDto,
  ) {
    return this.service.update(userId, condoId, areaId, dto);
  }

  @Delete(':areaId')
  remove(
    @CurrentUserId() userId: string,
    @Param('condoId', ParseUUIDPipe) condoId: string,
    @Param('areaId', ParseUUIDPipe) areaId: string,
  ) {
    return this.service.remove(userId, condoId, areaId);
  }

  @Get(':areaId/reservations')
  reservations(
    @CurrentUserId() userId: string,
    @Param('condoId', ParseUUIDPipe) condoId: string,
    @Param('areaId', ParseUUIDPipe) areaId: string,
  ) {
    return this.service.reservations(userId, condoId, areaId);
  }

  /** Calendário de ocupação (cores) da área. */
  @Get(':areaId/calendar')
  calendar(
    @CurrentUserId() userId: string,
    @Param('condoId', ParseUUIDPipe) condoId: string,
    @Param('areaId', ParseUUIDPipe) areaId: string,
  ) {
    return this.service.calendar(userId, condoId, areaId);
  }

  /** Reserva o dia em nome da administração (azul no calendário). */
  @Post(':areaId/reservations')
  reserveAsManagement(
    @CurrentUserId() userId: string,
    @Param('condoId', ParseUUIDPipe) condoId: string,
    @Param('areaId', ParseUUIDPipe) areaId: string,
    @Body() dto: ManagementReservationDto,
  ) {
    return this.service.reserveAsManagement(userId, condoId, areaId, dto);
  }

  /** Aprova/recusa uma reserva pendente do morador. */
  @Patch(':areaId/reservations/:resId')
  decideReservation(
    @CurrentUserId() userId: string,
    @Param('condoId', ParseUUIDPipe) condoId: string,
    @Param('areaId', ParseUUIDPipe) areaId: string,
    @Param('resId', ParseUUIDPipe) resId: string,
    @Body() dto: DecideReservationDto,
  ) {
    return this.service.decideReservation(userId, condoId, areaId, resId, dto.action === 'approve');
  }

  @Delete(':areaId/reservations/:resId')
  cancelReservation(
    @CurrentUserId() userId: string,
    @Param('condoId', ParseUUIDPipe) condoId: string,
    @Param('areaId', ParseUUIDPipe) areaId: string,
    @Param('resId', ParseUUIDPipe) resId: string,
  ) {
    return this.service.cancelReservation(userId, condoId, areaId, resId);
  }

  /** Marca/desmarca um dia como indisponível. */
  @Put(':areaId/blocks')
  setBlock(
    @CurrentUserId() userId: string,
    @Param('condoId', ParseUUIDPipe) condoId: string,
    @Param('areaId', ParseUUIDPipe) areaId: string,
    @Body() dto: SetAreaBlockDto,
  ) {
    return this.service.setBlock(userId, condoId, areaId, dto);
  }
}
