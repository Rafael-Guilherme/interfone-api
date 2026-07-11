import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { AnnouncementsService } from './announcements.service';
import { CreateAnnouncementDto } from './dto';
import { CurrentUserId, JwtAuthGuard } from '../common/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('condominiums/:condoId/announcements')
export class AnnouncementsController {
  constructor(private readonly service: AnnouncementsService) {}

  @Post()
  create(
    @CurrentUserId() userId: string,
    @Param('condoId', ParseUUIDPipe) condoId: string,
    @Body() dto: CreateAnnouncementDto,
  ) {
    return this.service.create(userId, condoId, dto);
  }

  @Get()
  list(@CurrentUserId() userId: string, @Param('condoId', ParseUUIDPipe) condoId: string) {
    return this.service.list(userId, condoId);
  }
}
