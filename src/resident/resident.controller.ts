import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ResidentService } from './resident.service';
import { CreateReservationDto, CreateResidentQrDto } from './dto';
import { CurrentUserId, JwtAuthGuard } from '../common/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('condominiums/:condoId/resident')
export class ResidentController {
  constructor(private readonly service: ResidentService) {}

  @Get('areas')
  areas(@CurrentUserId() u: string, @Param('condoId', ParseUUIDPipe) c: string) {
    return this.service.areas(u, c);
  }

  @Post('reservations')
  createReservation(@CurrentUserId() u: string, @Param('condoId', ParseUUIDPipe) c: string, @Body() dto: CreateReservationDto) {
    return this.service.createReservation(u, c, dto);
  }

  @Get('reservations')
  myReservations(@CurrentUserId() u: string, @Param('condoId', ParseUUIDPipe) c: string) {
    return this.service.myReservations(u, c);
  }

  @Delete('reservations/:resId')
  cancel(@CurrentUserId() u: string, @Param('condoId', ParseUUIDPipe) c: string, @Param('resId', ParseUUIDPipe) r: string) {
    return this.service.cancelReservation(u, c, r);
  }

  @Get('feed')
  feed(@CurrentUserId() u: string, @Param('condoId', ParseUUIDPipe) c: string) {
    return this.service.feed(u, c);
  }

  @Post('feed/:annId/read')
  read(@CurrentUserId() u: string, @Param('condoId', ParseUUIDPipe) c: string, @Param('annId', ParseUUIDPipe) a: string) {
    return this.service.markRead(u, c, a);
  }

  @Get('recados')
  recados(@CurrentUserId() u: string, @Param('condoId', ParseUUIDPipe) c: string) {
    return this.service.recados(u, c);
  }

  @Get('calls')
  callHistory(@CurrentUserId() u: string, @Param('condoId', ParseUUIDPipe) c: string) {
    return this.service.callHistory(u, c);
  }

  @Get('qrcodes')
  myQrs(@CurrentUserId() u: string, @Param('condoId', ParseUUIDPipe) c: string) {
    return this.service.myQrs(u, c);
  }

  @Post('qrcodes')
  createQr(@CurrentUserId() u: string, @Param('condoId', ParseUUIDPipe) c: string, @Body() dto: CreateResidentQrDto) {
    return this.service.createQr(u, c, dto);
  }

  @Delete('qrcodes/:qrId')
  deleteQr(@CurrentUserId() u: string, @Param('condoId', ParseUUIDPipe) c: string, @Param('qrId', ParseUUIDPipe) q: string) {
    return this.service.deleteQr(u, c, q);
  }
}
