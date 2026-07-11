import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  HttpCode,
} from '@nestjs/common';
import { DeliveryService } from './delivery.service';
import { DeliveryCallDto, LeaveMessageDto } from './dto';

/**
 * Web do entregador — PÚBLICA. Nenhum guard de autenticação.
 *
 * É o único controller sem @Auth. Isolá-lo num módulo próprio deixa o limite de
 * segurança explícito: nada aqui herda contexto de usuário, e o service só
 * devolve rótulos de local (LGPD). O `:token` do QR é a única credencial, e é
 * de baixo privilégio (resolve só o condo e as unidades para ligar).
 *
 * Rate limiting (por IP/token) deve ser aplicado neste controller na
 * implementação — omitido no esqueleto.
 */
@Controller('q')
export class DeliveryController {
  constructor(private readonly service: DeliveryService) {}

  @Get(':token')
  resolve(@Param('token') token: string) {
    return this.service.resolve(token);
  }

  @Post(':token/call')
  call(@Param('token') token: string, @Body() dto: DeliveryCallDto) {
    return this.service.call(token, dto);
  }

  @Post(':token/message')
  @HttpCode(201)
  leaveMessage(
    @Param('token') token: string,
    @Body() dto: LeaveMessageDto,
  ) {
    return this.service.leaveMessage(token, dto);
  }
}
