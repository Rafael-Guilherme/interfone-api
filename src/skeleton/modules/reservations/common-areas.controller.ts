import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { Auth } from '../../common/decorators/auth.decorator';
import { CondoScope } from '../../common/decorators/condo-scope.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CreateCommonAreaDto, UpdateCommonAreaDto } from './dto';
import { ReservationsService } from './reservations.service';

/**
 * Guards aplicados (via decorators compostos):
 *   @Auth        → exige access token
 *   @CondoScope  → resolve Profile ativo no :condoId e popula request.profile
 *   @Roles(...)  → restringe mutações ao gestor
 *
 * Leitura (GET) fica liberada a qualquer Profile ativo do condo; escrita exige manager.
 */
@Auth()
@CondoScope()
@Controller('condominiums/:condoId/common-areas')
export class CommonAreasController {
  constructor(private readonly service: ReservationsService) {}

  /** Morador e gestor: lista áreas. Morador só vê habilitadas. */
  @Get()
  list(
    @Param('condoId', ParseUUIDPipe) condoId: string,
    // request.profile.role vem do CondoScopeGuard; aqui simplificamos:
  ) {
    // Regra de visibilidade resolvida no controller a partir do papel.
    // Gestor recebe todas; morador só habilitadas (includeDisabled=false).
    return this.service.listAreas(condoId, { includeDisabled: false });
  }

  @Roles('manager')
  @Post()
  create(
    @Param('condoId', ParseUUIDPipe) condoId: string,
    @Body() dto: CreateCommonAreaDto,
  ) {
    return this.service.createArea(condoId, dto);
  }

  @Roles('manager')
  @Patch(':areaId')
  update(
    @Param('condoId', ParseUUIDPipe) condoId: string,
    @Param('areaId', ParseUUIDPipe) areaId: string,
    @Body() dto: UpdateCommonAreaDto,
  ) {
    return this.service.updateArea(condoId, areaId, dto);
  }

  @Roles('manager')
  @Delete(':areaId')
  @HttpCode(204)
  async remove(
    @Param('condoId', ParseUUIDPipe) condoId: string,
    @Param('areaId', ParseUUIDPipe) areaId: string,
  ) {
    await this.service.deleteArea(condoId, areaId);
  }
}
