import { Controller, Get, Param, ParseUUIDPipe, Post, HttpCode } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { Auth } from '../../common/decorators/auth.decorator';
import { CondoScope } from '../../common/decorators/condo-scope.decorator';
import { ActiveStatus } from '../../common/decorators/active-status.decorator';
import {
  CurrentProfile,
  ProfileContext,
} from '../../common/decorators/current-profile.decorator';

/**
 * Recados (②·5). Sem modelo próprio: unifica duas fontes numa única lista
 * ordenada por tempo —
 *   - Call com status missed|declined e caller_kind=resident (chamada interna perdida)
 *   - MissedCallMessage (recado deixado pelo entregador na web)
 */
@Injectable()
export class MessagesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(condominiumId: string, unitIds: string[]) {
    const [missedCalls, deliveryMsgs] = await Promise.all([
      this.prisma.call.findMany({
        where: {
          condominium_id: condominiumId,
          unit_id: { in: unitIds },
          caller_kind: 'resident',
          status: { in: ['missed', 'declined'] },
        },
        orderBy: { started_at: 'desc' },
        take: 100,
      }),
      this.prisma.missedCallMessage.findMany({
        where: { condominium_id: condominiumId, unit_id: { in: unitIds } },
        orderBy: { created_at: 'desc' },
        take: 100,
      }),
    ]);

    const items = [
      ...missedCalls.map((c: any) => ({
        kind: 'missed_call' as const,
        id: c.id,
        at: c.started_at,
        media: c.media,
        read: true, // chamadas não têm flag de leitura própria
      })),
      ...deliveryMsgs.map((m: any) => ({
        kind: 'delivery_message' as const,
        id: m.id,
        at: m.created_at,
        visitor_name: m.visitor_name,
        reason: m.reason,
        read: m.read_at != null,
      })),
    ];

    items.sort((a, b) => b.at.getTime() - a.at.getTime());
    return items;
  }

  markMessageRead(messageId: string) {
    return this.prisma.missedCallMessage.update({
      where: { id: messageId },
      data: { read_at: new Date() },
    });
  }
}

@Auth()
@CondoScope()
@ActiveStatus()
@Controller('condominiums/:condoId/messages')
export class MessagesController {
  constructor(private readonly service: MessagesService) {}

  @Get()
  list(
    @Param('condoId', ParseUUIDPipe) condoId: string,
    @CurrentProfile() profile: ProfileContext,
  ) {
    // unitIds do morador vêm do contexto resolvido pelo CondoScopeGuard.
    return this.service.list(condoId, profile.unitIds ?? []);
  }

  @Post(':messageId/read')
  @HttpCode(200)
  markRead(@Param('messageId', ParseUUIDPipe) messageId: string) {
    return this.service.markMessageRead(messageId);
  }
}
