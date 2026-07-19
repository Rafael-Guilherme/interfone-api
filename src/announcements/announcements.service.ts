import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ManagerAccess } from '../condominiums/manager-access.service';
import { CreateAnnouncementDto } from './dto';

/** Comunicados do síndico (④·5). Push aos moradores é TODO (fase 5). */
@Injectable()
export class AnnouncementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ManagerAccess,
  ) {}

  async create(userId: string, condoId: string, dto: CreateAnnouncementDto) {
    const manager = await this.access.assert(userId, condoId, 'announcements');
    const scope = dto.scope ?? 'all';
    if (scope === 'block' && !dto.block_id) {
      throw new BadRequestException('Selecione o bloco para um comunicado por bloco.');
    }
    const a = await this.prisma.announcement.create({
      data: {
        condominium_id: condoId,
        author_id: manager.id,
        title: dto.title,
        body: dto.body,
        scope,
        block_id: scope === 'block' ? dto.block_id ?? null : null,
      },
      select: { id: true, title: true, created_at: true },
    });
    return a;
  }

  async list(userId: string, condoId: string) {
    await this.access.assert(userId, condoId);
    const rows = await this.prisma.announcement.findMany({
      where: { condominium_id: condoId },
      orderBy: { created_at: 'desc' },
      include: { block: { select: { name: true } }, _count: { select: { reads: true } } },
    });
    return rows.map((a) => ({
      id: a.id,
      title: a.title,
      body: a.body,
      scope: a.scope,
      block: a.block?.name ?? null,
      reads: a._count.reads,
      created_at: a.created_at,
    }));
  }
}
