import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ManagerAccess } from '../condominiums/manager-access.service';
import { CreateContactDto, UpdateContactDto } from './dto';

/**
 * Contatos internos do condomínio (comunicação interna, wireframe DEFM·4):
 * portaria, zelador, administração, ramais. O morador liga; o síndico cadastra.
 *
 * "A princípio apenas contatos adicionados e do próprio condomínio" (decisão do
 * usuário): não há diretório morador-a-morador aqui — só o que o síndico
 * cadastra para o prédio.
 */
@Injectable()
export class InternalContactsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ManagerAccess,
  ) {}

  /** Qualquer perfil ATIVO do condomínio pode ver os contatos (morador incluso). */
  private async assertMember(userId: string, condoId: string) {
    const profile = await this.prisma.profile.findFirst({
      where: { user_id: userId, condominium_id: condoId, status: 'active' },
      select: { id: true },
    });
    if (!profile) throw new ForbiddenException('Você não faz parte deste interfone.');
  }

  /** Lista para o morador: só os ativos, na ordem definida pelo síndico. */
  async listForMember(userId: string, condoId: string) {
    await this.assertMember(userId, condoId);
    return this.prisma.internalContact.findMany({
      where: { condominium_id: condoId, enabled: true },
      orderBy: [{ display_order: 'asc' }, { created_at: 'asc' }],
      select: { id: true, name: true, phone: true, note: true },
    });
  }

  /** Lista para o gestor: inclui os desativados e o toggle. */
  async listForManager(userId: string, condoId: string) {
    await this.access.assert(userId, condoId);
    return this.prisma.internalContact.findMany({
      where: { condominium_id: condoId },
      orderBy: [{ display_order: 'asc' }, { created_at: 'asc' }],
    });
  }

  async create(userId: string, condoId: string, dto: CreateContactDto) {
    await this.access.assert(userId, condoId, 'settings');
    return this.prisma.internalContact.create({
      data: {
        condominium_id: condoId,
        name: dto.name.trim(),
        phone: dto.phone.trim(),
        note: dto.note?.trim() || null,
        display_order: dto.display_order ?? 0,
      },
    });
  }

  async update(userId: string, condoId: string, contactId: string, dto: UpdateContactDto) {
    await this.access.assert(userId, condoId, 'settings');
    await this.owned(condoId, contactId);
    return this.prisma.internalContact.update({
      where: { id: contactId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.phone !== undefined ? { phone: dto.phone.trim() } : {}),
        ...(dto.note !== undefined ? { note: dto.note?.trim() || null } : {}),
        ...(dto.display_order !== undefined ? { display_order: dto.display_order } : {}),
        ...(dto.enabled !== undefined ? { enabled: dto.enabled } : {}),
      },
    });
  }

  async remove(userId: string, condoId: string, contactId: string) {
    await this.access.assert(userId, condoId, 'settings');
    await this.owned(condoId, contactId);
    await this.prisma.internalContact.delete({ where: { id: contactId } });
    return { ok: true };
  }

  private async owned(condoId: string, contactId: string) {
    const c = await this.prisma.internalContact.findFirst({
      where: { id: contactId, condominium_id: condoId },
      select: { id: true },
    });
    if (!c) throw new NotFoundException('Contato não encontrado.');
  }
}
