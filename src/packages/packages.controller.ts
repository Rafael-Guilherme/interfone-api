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
import { PackagesService } from './packages.service';
import { CreatePackageDto, ListPackagesQuery, PickupDto } from './dto';
import { CurrentUserId, JwtAuthGuard } from '../common/jwt-auth.guard';

/** Encomendas do lado da gestão (portaria/síndico). */
@UseGuards(JwtAuthGuard)
@Controller('condominiums/:condoId/packages')
export class PackagesController {
  constructor(private readonly service: PackagesService) {}

  @Get()
  list(
    @CurrentUserId() u: string,
    @Param('condoId', ParseUUIDPipe) c: string,
    @Query() q: ListPackagesQuery,
  ) {
    return this.service.list(u, c, q.status);
  }

  @Post()
  create(
    @CurrentUserId() u: string,
    @Param('condoId', ParseUUIDPipe) c: string,
    @Body() dto: CreatePackageDto,
  ) {
    return this.service.create(u, c, dto);
  }

  @Patch(':pkgId/pickup')
  pickup(
    @CurrentUserId() u: string,
    @Param('condoId', ParseUUIDPipe) c: string,
    @Param('pkgId', ParseUUIDPipe) p: string,
    @Body() dto: PickupDto,
  ) {
    return this.service.pickup(u, c, p, dto.nota);
  }

  @Delete(':pkgId')
  remove(
    @CurrentUserId() u: string,
    @Param('condoId', ParseUUIDPipe) c: string,
    @Param('pkgId', ParseUUIDPipe) p: string,
  ) {
    return this.service.remove(u, c, p);
  }
}

/** Encomendas do lado do morador — só as das unidades dele. */
@UseGuards(JwtAuthGuard)
@Controller('condominiums/:condoId/resident/packages')
export class ResidentPackagesController {
  constructor(private readonly service: PackagesService) {}

  @Get()
  mine(@CurrentUserId() u: string, @Param('condoId', ParseUUIDPipe) c: string) {
    return this.service.mine(u, c);
  }

  @Patch(':pkgId/pickup')
  pickup(
    @CurrentUserId() u: string,
    @Param('condoId', ParseUUIDPipe) c: string,
    @Param('pkgId', ParseUUIDPipe) p: string,
  ) {
    return this.service.pickupMine(u, c, p);
  }
}
