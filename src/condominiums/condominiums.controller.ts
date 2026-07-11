import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CondominiumsService } from './condominiums.service';
import {
  BlockDto,
  CreateCondominiumDto,
  JoinDto,
  ResidentActionDto,
  UnitDto,
  UpdateCondominiumDto,
} from './dto';
import { CurrentUserId, JwtAuthGuard } from '../common/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('condominiums')
export class CondominiumsController {
  constructor(private readonly service: CondominiumsService) {}

  // ---- criação / listagem ----
  @Post()
  create(@CurrentUserId() userId: string, @Body() dto: CreateCondominiumDto) {
    return this.service.create(userId, dto);
  }

  @Get('mine')
  mine(@CurrentUserId() userId: string) {
    return this.service.listMine(userId);
  }

  /** Morador resolve um condomínio pelo código para entrar. */
  @Get('lookup')
  lookup(@Query('code') code: string) {
    return this.service.lookupByCode(code ?? '');
  }

  // ---- painel ----
  @Get(':id')
  detail(@CurrentUserId() userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.detail(userId, id);
  }

  @Patch(':id')
  update(@CurrentUserId() userId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCondominiumDto) {
    return this.service.update(userId, id, dto);
  }

  // ---- moradores ----
  @Get(':id/residents')
  residents(
    @CurrentUserId() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('status') status?: string,
  ) {
    return this.service.listResidents(userId, id, status);
  }

  @Patch(':id/residents/:pid')
  setResident(
    @CurrentUserId() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('pid', ParseUUIDPipe) pid: string,
    @Body() dto: ResidentActionDto,
  ) {
    return this.service.setResidentStatus(userId, id, pid, dto.action);
  }

  @Post(':id/join')
  join(@CurrentUserId() userId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: JoinDto) {
    return this.service.join(userId, id, dto);
  }

  // ---- estrutura (blocos / unidades) ----
  @Get(':id/structure')
  structure(@CurrentUserId() userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.structure(userId, id);
  }

  @Post(':id/blocks')
  createBlock(@CurrentUserId() userId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: BlockDto) {
    return this.service.createBlock(userId, id, dto);
  }

  @Patch(':id/blocks/:blockId')
  updateBlock(
    @CurrentUserId() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('blockId', ParseUUIDPipe) blockId: string,
    @Body() dto: BlockDto,
  ) {
    return this.service.updateBlock(userId, id, blockId, dto);
  }

  @Delete(':id/blocks/:blockId')
  deleteBlock(
    @CurrentUserId() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('blockId', ParseUUIDPipe) blockId: string,
  ) {
    return this.service.deleteBlock(userId, id, blockId);
  }

  @Post(':id/units')
  createUnit(@CurrentUserId() userId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UnitDto) {
    return this.service.createUnit(userId, id, dto);
  }

  @Patch(':id/units/:unitId')
  updateUnit(
    @CurrentUserId() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('unitId', ParseUUIDPipe) unitId: string,
    @Body() dto: UnitDto,
  ) {
    return this.service.updateUnit(userId, id, unitId, dto);
  }

  @Delete(':id/units/:unitId')
  deleteUnit(
    @CurrentUserId() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('unitId', ParseUUIDPipe) unitId: string,
  ) {
    return this.service.deleteUnit(userId, id, unitId);
  }
}
