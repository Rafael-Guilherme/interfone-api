import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ManagerAccess } from '../condominiums/manager-access.service';
import { ResidentAccess } from '../resident/resident-access.service';
import { CreatePackageDto } from './dto';

/**
 * Encomendas: a portaria/síndico registra o que chegou, o morador vê o que é
 * dele e qualquer um dos dois marca a retirada.
 *
 * Sem push ainda, o morador só descobre abrindo o app — quando o push existir,
 * é aqui (no create) que a notificação deve ser disparada.
 */
@Injectable()
export class PackagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly manager: ManagerAccess,
    private readonly resident: ResidentAccess,
  ) {}

  private label(u: { number: string; block: { name: string } | null }) {
    return u.block ? `Bloco ${u.block.name} · ${u.number}` : u.number;
  }

  // -------------------- lado do síndico --------------------

  async list(userId: string, condoId: string, status?: 'waiting' | 'picked_up') {
    await this.manager.assert(userId, condoId);
    const rows = await this.prisma.package.findMany({
      where: { condominium_id: condoId, ...(status ? { status } : {}) },
      orderBy: [{ status: 'asc' }, { received_at: 'desc' }],
      take: 200,
      include: { unit: { include: { block: { select: { name: true } } } } },
    });
    return rows.map((p) => ({
      id: p.id,
      unidade: this.label(p.unit),
      unit_id: p.unit_id,
      descricao: p.description,
      destinatario: p.recipient,
      transportadora: p.carrier,
      status: p.status,
      recebida_em: p.received_at,
      retirada_em: p.picked_up_at,
      retirada_por: p.picked_up_note,
    }));
  }

  async create(userId: string, condoId: string, dto: CreatePackageDto) {
    const profile = await this.manager.assert(userId, condoId, 'packages');
    const unit = await this.prisma.unit.findFirst({
      where: { id: dto.unit_id, condominium_id: condoId },
      select: { id: true },
    });
    if (!unit) throw new NotFoundException('Unidade inválida.');

    const p = await this.prisma.package.create({
      data: {
        condominium_id: condoId,
        unit_id: unit.id,
        description: dto.description.trim(),
        recipient: dto.recipient?.trim() || null,
        carrier: dto.carrier?.trim() || null,
        registered_by: profile.id,
      },
      select: { id: true, received_at: true },
    });
    return { ok: true, ...p };
  }

  /** Marca retirada (idempotente: retirar de novo não muda a data original). */
  async pickup(userId: string, condoId: string, pkgId: string, nota?: string) {
    await this.manager.assert(userId, condoId, 'packages');
    const pkg = await this.prisma.package.findFirst({
      where: { id: pkgId, condominium_id: condoId },
    });
    if (!pkg) throw new NotFoundException('Encomenda não encontrada.');
    if (pkg.status === 'picked_up') return { ok: true, ja_retirada: true };

    await this.prisma.package.update({
      where: { id: pkg.id },
      data: { status: 'picked_up', picked_up_at: new Date(), picked_up_note: nota?.trim() || null },
    });
    return { ok: true };
  }

  async remove(userId: string, condoId: string, pkgId: string) {
    await this.manager.assert(userId, condoId, 'packages');
    const pkg = await this.prisma.package.findFirst({
      where: { id: pkgId, condominium_id: condoId },
      select: { id: true },
    });
    if (!pkg) throw new NotFoundException('Encomenda não encontrada.');
    await this.prisma.package.delete({ where: { id: pkg.id } });
    return { ok: true };
  }

  // -------------------- lado do morador --------------------

  /** Só as encomendas das unidades do próprio morador. */
  async mine(userId: string, condoId: string) {
    const { unitIds } = await this.resident.assert(userId, condoId);
    const rows = await this.prisma.package.findMany({
      where: { condominium_id: condoId, unit_id: { in: unitIds } },
      orderBy: [{ status: 'asc' }, { received_at: 'desc' }],
      take: 100,
      include: { unit: { include: { block: { select: { name: true } } } } },
    });
    return rows.map((p) => ({
      id: p.id,
      unidade: this.label(p.unit),
      descricao: p.description,
      destinatario: p.recipient,
      transportadora: p.carrier,
      status: p.status,
      recebida_em: p.received_at,
      retirada_em: p.picked_up_at,
    }));
  }

  /** O morador confirma que retirou — só das unidades dele. */
  async pickupMine(userId: string, condoId: string, pkgId: string) {
    const { unitIds } = await this.resident.assert(userId, condoId);
    const pkg = await this.prisma.package.findFirst({
      where: { id: pkgId, condominium_id: condoId, unit_id: { in: unitIds } },
    });
    if (!pkg) throw new NotFoundException('Encomenda não encontrada.');
    if (pkg.status === 'picked_up') return { ok: true, ja_retirada: true };

    await this.prisma.package.update({
      where: { id: pkg.id },
      data: { status: 'picked_up', picked_up_at: new Date(), picked_up_note: 'confirmado pelo morador' },
    });
    return { ok: true };
  }
}
