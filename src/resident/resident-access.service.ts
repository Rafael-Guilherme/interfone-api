import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** Verifica que o usuário é MORADOR ativo do condomínio; devolve o profile + unidades. */
@Injectable()
export class ResidentAccess {
  constructor(private readonly prisma: PrismaService) {}

  async assert(userId: string, condoId: string) {
    const profile = await this.prisma.profile.findFirst({
      where: { user_id: userId, condominium_id: condoId, role: 'resident', status: 'active' },
      include: { unit_memberships: { select: { unit_id: true } } },
    });
    if (!profile) throw new ForbiddenException('Você não é morador ativo deste interfone.');
    return { profile, unitIds: profile.unit_memberships.map((m) => m.unit_id) };
  }
}
