import {
  Body,
  Controller,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { Auth } from '../../common/decorators/auth.decorator';
import { CondoScope } from '../../common/decorators/condo-scope.decorator';
import { ActiveStatus } from '../../common/decorators/active-status.decorator';
import {
  CurrentProfile,
  ProfileContext,
} from '../../common/decorators/current-profile.decorator';
import { AnswerCallDto, StartCallDto } from './dto';
import { CallsService } from './calls.service';

/**
 * Chamadas internas (morador→morador / morador→unidade).
 * Só morador ativo pode iniciar/atender — @ActiveStatus é o gate de aprovação.
 * Chamadas do entregador vivem no módulo `delivery` (público, sem auth).
 */
@Auth()
@CondoScope()
@ActiveStatus()
@Controller('condominiums/:condoId/calls')
export class CallsController {
  constructor(private readonly service: CallsService) {}

  @Post()
  start(
    @Param('condoId', ParseUUIDPipe) condoId: string,
    @Body() dto: StartCallDto,
    @CurrentProfile() profile: ProfileContext,
  ) {
    return this.service.start(
      condoId,
      { profileId: profile.id, userId: profile.userId, name: profile.name },
      dto,
    );
  }

  @Post(':callId/answer')
  answer(
    @Param('callId', ParseUUIDPipe) callId: string,
    @Body() dto: AnswerCallDto,
    @CurrentProfile() profile: ProfileContext,
  ) {
    return this.service.answer(
      callId,
      { profileId: profile.id, name: profile.name },
      dto,
    );
  }

  @Post(':callId/decline')
  @HttpCode(200)
  decline(@Param('callId', ParseUUIDPipe) callId: string) {
    return this.service.decline(callId);
  }

  @Post(':callId/end')
  @HttpCode(200)
  end(
    @Param('callId', ParseUUIDPipe) callId: string,
    @CurrentProfile() profile: ProfileContext,
  ) {
    return this.service.end(callId, { profileId: profile.id });
  }
}
