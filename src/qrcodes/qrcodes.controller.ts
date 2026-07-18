import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { QrCodesService } from './qrcodes.service';
import { CreateQrDto, UpdateQrDto } from './dto';
import { CurrentUserId, JwtAuthGuard } from '../common/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('condominiums/:condoId/qrcodes')
export class QrCodesController {
  constructor(private readonly service: QrCodesService) {}

  @Get()
  list(@CurrentUserId() userId: string, @Param('condoId', ParseUUIDPipe) condoId: string) {
    return this.service.list(userId, condoId);
  }

  @Post()
  create(@CurrentUserId() userId: string, @Param('condoId', ParseUUIDPipe) condoId: string, @Body() dto: CreateQrDto) {
    return this.service.create(userId, condoId, dto);
  }

  @Patch(':qrId')
  update(
    @CurrentUserId() userId: string,
    @Param('condoId', ParseUUIDPipe) condoId: string,
    @Param('qrId', ParseUUIDPipe) qrId: string,
    @Body() dto: UpdateQrDto,
  ) {
    return this.service.update(userId, condoId, qrId, dto);
  }

  @Delete(':qrId')
  remove(
    @CurrentUserId() userId: string,
    @Param('condoId', ParseUUIDPipe) condoId: string,
    @Param('qrId', ParseUUIDPipe) qrId: string,
  ) {
    return this.service.remove(userId, condoId, qrId);
  }
}
