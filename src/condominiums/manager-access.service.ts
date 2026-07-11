import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** Verificação reutilizável: usuário é gestor ATIVO do condomínio. */
@Injectable()
export class ManagerAccess {
  constructor(private readonly prisma: PrismaService) {}

  async assert(userId: string, condoId: string) {
    const profile = await this.prisma.profile.findFirst({
      where: { user_id: userId, condominium_id: condoId, role: { in: ['manager', 'sub_manager'] } },
    });
    if (!profile) throw new ForbiddenException('Você não gerencia este interfone.');
    if (profile.status !== 'active') {
      throw new ForbiddenException('Interfone aguardando autorização do administrador.');
    }
    return profile;
  }
}
