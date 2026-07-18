import { Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { ManagerAccess } from '../condominiums/manager-access.service';
import { CreateQrDto, UpdateQrDto } from './dto';

/** QR codes do síndico (③·7) — portaria geral / por unidade. */
@Injectable()
export class QrCodesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ManagerAccess,
  ) {}

  async list(userId: string, condoId: string) {
    await this.access.assert(userId, condoId);
    const rows = await this.prisma.qrCode.findMany({
      where: { condominium_id: condoId, kind: 'manager' },
      orderBy: { created_at: 'asc' },
      include: { unit: { include: { block: { select: { name: true } } } } },
    });
    return rows.map((q) => ({
      id: q.id,
      label: q.label,
      token: q.token,
      active: q.active,
      used_count: q.used_count,
      unit: q.unit ? (q.unit.block ? `Bloco ${q.unit.block.name} · ${q.unit.number}` : q.unit.number) : null,
      created_at: q.created_at,
    }));
  }

  async create(userId: string, condoId: string, dto: CreateQrDto) {
    await this.access.assert(userId, condoId);
    if (dto.unit_id) {
      const unit = await this.prisma.unit.findFirst({ where: { id: dto.unit_id, condominium_id: condoId }, select: { id: true } });
      if (!unit) throw new NotFoundException('Unidade não encontrada neste condomínio.');
    }
    const qr = await this.prisma.qrCode.create({
      data: {
        condominium_id: condoId,
        unit_id: dto.unit_id ?? null,
        kind: 'manager',
        label: dto.label ?? (dto.unit_id ? 'Unidade' : 'Portaria'),
        token: randomBytes(8).toString('base64url').slice(0, 10),
        active: true,
      },
      select: { id: true, label: true, token: true, active: true },
    });
    return qr;
  }

  async update(userId: string, condoId: string, qrId: string, dto: UpdateQrDto) {
    await this.access.assert(userId, condoId);
    await this.owned(condoId, qrId);
    return this.prisma.qrCode.update({
      where: { id: qrId },
      data: {
        ...(dto.label !== undefined ? { label: dto.label } : {}),
        ...(dto.active !== undefined ? { active: dto.active } : {}),
      },
      select: { id: true, label: true, active: true },
    });
  }

  async remove(userId: string, condoId: string, qrId: string) {
    await this.access.assert(userId, condoId);
    await this.owned(condoId, qrId);
    await this.prisma.qrCode.delete({ where: { id: qrId } });
    return { ok: true };
  }

  private async owned(condoId: string, qrId: string) {
    const q = await this.prisma.qrCode.findFirst({ where: { id: qrId, condominium_id: condoId }, select: { id: true } });
    if (!q) throw new NotFoundException('QR code não encontrado.');
  }
}
