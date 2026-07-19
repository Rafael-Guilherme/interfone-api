import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Áreas do painel que um sub-gestor pode receber. O síndico titular
 * (role=manager) tem todas por definição — a lista só governa sub_manager.
 */
export const PERMISSOES = [
  'residents', // aprovar/gerenciar moradores
  'structure', // blocos e unidades
  'announcements', // comunicados
  'areas', // áreas comuns e reservas
  'packages', // encomendas
  'qrcodes', // QR codes da portaria
  'settings', // dados do condomínio e sub-gestores
] as const;

export type Permissao = (typeof PERMISSOES)[number];

/** Verificação reutilizável: usuário é gestor ATIVO do condomínio. */
@Injectable()
export class ManagerAccess {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * `permissao` é opcional para não quebrar chamadas antigas — quando informada,
   * o sub-gestor precisa tê-la explicitamente. Conceder permissões NÃO passa
   * por aqui: exige `assertOwner`, senão um sub-gestor com `settings` poderia
   * ampliar os próprios poderes.
   */
  async assert(userId: string, condoId: string, permissao?: Permissao) {
    const profile = await this.prisma.profile.findFirst({
      where: { user_id: userId, condominium_id: condoId, role: { in: ['manager', 'sub_manager'] } },
    });
    if (!profile) throw new ForbiddenException('Você não gerencia este interfone.');
    if (profile.status !== 'active') {
      throw new ForbiddenException('Interfone aguardando autorização do administrador.');
    }

    if (permissao && profile.role === 'sub_manager' && !profile.permissions.includes(permissao)) {
      throw new ForbiddenException(`Seu acesso não inclui "${permissao}".`);
    }
    return profile;
  }

  /** Só o síndico titular — usado onde delegar não faz sentido. */
  async assertOwner(userId: string, condoId: string) {
    const profile = await this.assert(userId, condoId);
    if (profile.role !== 'manager') {
      throw new ForbiddenException('Apenas o síndico titular pode fazer isso.');
    }
    return profile;
  }
}
