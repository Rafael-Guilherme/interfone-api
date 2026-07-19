import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { DeliveryService } from './delivery.service';
import { LeaveMessageDto, ResolveQuery } from './dto';

/** Web do entregador — PÚBLICA (sem @UseGuards). O :token do QR é a credencial. */
@Controller('q')
export class DeliveryController {
  constructor(private readonly service: DeliveryService) {}

  @Get(':token')
  resolve(@Param('token') token: string, @Query() q: ResolveQuery) {
    const pos = q.lat !== undefined && q.lng !== undefined ? { lat: q.lat, lng: q.lng } : undefined;
    return this.service.resolve(token, pos);
  }

  @Post(':token/recado')
  leaveMessage(@Param('token') token: string, @Body() body: LeaveMessageDto) {
    return this.service.leaveMessage(token, body);
  }
}
