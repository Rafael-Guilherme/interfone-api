import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Fluxo do entregador — anônimo, sem login. Só rótulos de local (LGPD):
 * nenhum nome/telefone/e-mail de morador é exposto aqui.
 */
@Injectable()
export class DeliveryService {
  constructor(private readonly prisma: PrismaService) {}

  /** Valida o token do QR e garante que está utilizável agora. */
  async resolveQr(token: string) {
    const qr = await this.prisma.qrCode.findUnique({
      where: { token },
      include: {
        condominium: { select: { id: true, name: true, status: true } },
        unit: { include: { block: { select: { name: true } } } },
      },
    });
    if (!qr || !qr.active || qr.condominium.status !== 'active') {
      throw new NotFoundException('QR code inválido.');
    }
    const now = new Date();
    if (qr.valid_from && now < qr.valid_from) throw new NotFoundException('QR ainda não válido.');
    if (qr.valid_until && now > qr.valid_until) throw new NotFoundException('QR expirado.');
    return qr;
  }

  /** GET /q/:token — condo + unidades para o entregador escolher. */
  async resolve(token: string) {
    const qr = await this.resolveQr(token);

    if (qr.unit_id && qr.unit) {
      return {
        condo: { id: qr.condominium.id, name: qr.condominium.name },
        scope: 'unit' as const,
        units: [this.unitLabel(qr.unit)],
      };
    }

    const units = await this.prisma.unit.findMany({
      where: { condominium_id: qr.condominium.id },
      include: { block: { select: { name: true } } },
      orderBy: [{ block: { name: 'asc' } }, { number: 'asc' }],
    });

    return {
      condo: { id: qr.condominium.id, name: qr.condominium.name },
      scope: 'condo' as const,
      units: units.map((u) => this.unitLabel(u)),
    };
  }

  private unitLabel(u: { id: string; number: string; block: { name: string } | null }) {
    return { id: u.id, label: u.block ? `Bloco ${u.block.name} · ${u.number}` : u.number };
  }
}
