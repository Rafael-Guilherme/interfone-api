import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query, UseGuards } from '@nestjs/common';
import { AdminService } from './admin.service';
import { CondoActionDto, ListCondosQuery, ListUsersQuery, SetProfileRoleDto, UserActionDto } from './dto';
import { CurrentUserId, JwtAuthGuard } from '../common/jwt-auth.guard';
import { SuperAdminGuard } from './super-admin.guard';

/** Painel web do administrador da plataforma. Ordem dos guards importa. */
@UseGuards(JwtAuthGuard, SuperAdminGuard)
@Controller('admin')
export class AdminController {
  constructor(private readonly service: AdminService) {}

  @Get('overview')
  overview() {
    return this.service.overview();
  }

  @Get('condominiums')
  condominiums(@Query() q: ListCondosQuery) {
    return this.service.condominiums(q.filtro ?? 'all');
  }

  /** Detalhe do condomínio + todos os usuários vinculados. */
  @Get('condominiums/:id')
  condominium(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.condominium(id);
  }

  @Patch('condominiums/:id')
  actOnCondominium(
    @CurrentUserId() admin: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CondoActionDto,
  ) {
    return this.service.actOnCondominium(admin, id, dto.action);
  }

  /** Promove/rebaixa um perfil: morador ↔ sub-gestor ↔ síndico titular. */
  @Patch('condominiums/:id/profiles/:profileId')
  setProfileRole(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('profileId', ParseUUIDPipe) profileId: string,
    @Body() dto: SetProfileRoleDto,
  ) {
    return this.service.setProfileRole(id, profileId, dto.role);
  }

  @Get('users')
  users(@Query() q: ListUsersQuery) {
    return this.service.users(q.q, 50, q.condo, q.papel);
  }

  @Patch('users/:id')
  actOnUser(
    @CurrentUserId() admin: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UserActionDto,
  ) {
    return this.service.actOnUser(admin, id, dto.action);
  }
}
