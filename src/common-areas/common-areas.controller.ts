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
import { CommonAreasService } from './common-areas.service';
import { CreateCommonAreaDto, UpdateCommonAreaDto } from './dto';
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
}
