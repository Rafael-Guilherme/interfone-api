import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { InternalContactsService } from './internal-contacts.service';
import { CreateContactDto, UpdateContactDto } from './dto';
import { CurrentUserId, JwtAuthGuard } from '../common/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('condominiums/:condoId')
export class InternalContactsController {
  constructor(private readonly service: InternalContactsService) {}

  /** Morador: lista os contatos internos ativos. */
  @Get('resident/contacts')
  listForMember(@CurrentUserId() u: string, @Param('condoId', ParseUUIDPipe) c: string) {
    return this.service.listForMember(u, c);
  }

  /** Gestor: lista completa (inclui desativados). */
  @Get('contacts')
  listForManager(@CurrentUserId() u: string, @Param('condoId', ParseUUIDPipe) c: string) {
    return this.service.listForManager(u, c);
  }

  @Post('contacts')
  create(
    @CurrentUserId() u: string,
    @Param('condoId', ParseUUIDPipe) c: string,
    @Body() dto: CreateContactDto,
  ) {
    return this.service.create(u, c, dto);
  }

  @Patch('contacts/:contactId')
  update(
    @CurrentUserId() u: string,
    @Param('condoId', ParseUUIDPipe) c: string,
    @Param('contactId', ParseUUIDPipe) id: string,
    @Body() dto: UpdateContactDto,
  ) {
    return this.service.update(u, c, id, dto);
  }

  @Delete('contacts/:contactId')
  remove(
    @CurrentUserId() u: string,
    @Param('condoId', ParseUUIDPipe) c: string,
    @Param('contactId', ParseUUIDPipe) id: string,
  ) {
    return this.service.remove(u, c, id);
  }
}
