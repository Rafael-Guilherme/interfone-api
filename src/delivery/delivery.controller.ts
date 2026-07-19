import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { DeliveryService } from './delivery.service';
import { LeaveMessageDto } from './dto';

/** Web do entregador — PÚBLICA (sem @UseGuards). O :token do QR é a credencial. */
@Controller('q')
export class DeliveryController {
  constructor(private readonly service: DeliveryService) {}

  @Get(':token')
  resolve(@Param('token') token: string) {
    return this.service.resolve(token);
  }

  @Post(':token/recado')
  leaveMessage(@Param('token') token: string, @Body() body: LeaveMessageDto) {
    return this.service.leaveMessage(token, body);
  }
}
