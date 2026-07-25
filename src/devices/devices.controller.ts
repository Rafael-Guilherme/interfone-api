import { Body, Controller, Delete, Post, UseGuards } from '@nestjs/common';
import { DevicesService } from './devices.service';
import { RegisterDeviceDto } from './dto';
import { CurrentUserId, JwtAuthGuard } from '../common/jwt-auth.guard';

/**
 * Aparelhos do usuário para push. O app chama `POST` depois do login (e a cada
 * abertura, já que o token pode mudar) e `DELETE` no logout.
 */
@UseGuards(JwtAuthGuard)
@Controller('me/devices')
export class DevicesController {
  constructor(private readonly devices: DevicesService) {}

  @Post()
  register(@CurrentUserId() userId: string, @Body() dto: RegisterDeviceDto) {
    return this.devices.register(userId, dto);
  }

  /** Corpo em vez de path param: o token tem `[` e `]`, que não passam limpos na URL. */
  @Delete()
  unregister(@CurrentUserId() userId: string, @Body() dto: { push_token: string }) {
    return this.devices.unregister(userId, dto?.push_token ?? '');
  }
}
