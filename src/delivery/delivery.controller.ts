import { Controller, Get, Param } from '@nestjs/common';
import { DeliveryService } from './delivery.service';

/** Web do entregador — PÚBLICA (sem @UseGuards). O :token do QR é a credencial. */
@Controller('q')
export class DeliveryController {
  constructor(private readonly service: DeliveryService) {}

  @Get(':token')
  resolve(@Param('token') token: string) {
    return this.service.resolve(token);
  }
}
