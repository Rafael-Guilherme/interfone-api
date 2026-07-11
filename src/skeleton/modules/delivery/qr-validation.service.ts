import { Injectable, GoneException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * Validação de QR — compartilhada entre o módulo qrcodes (gestão) e delivery (uso).
 *
 * O estado "ativo/expirado" NÃO é persistido: é derivado em runtime a partir de
 * validity_mode (today|period|fixed) e usage_mode (single|unlimited). Isso evita
 * um job de expiração e mantém o QR como fonte única de verdade.
 */
@Injectable()
export class QrValidationService {
  constructor(private readonly prisma: PrismaService) {}

  /** Resolve um token de QR e garante que está utilizável AGORA. Lança se não. */
  async resolveUsable(token: string) {
    const qr = await this.prisma.qrCode.findUnique({
      where: { token },
      include: {
        condominium: { select: { id: true, name: true, status: true } },
        unit: { select: { id: true, number: true, block_id: true } },
      },
    });

    if (!qr || !qr.active || qr.condominium.status !== 'active') {
      throw new NotFoundException('QR code inválido.');
    }

    const now = new Date();

    // Janela de validade.
    if (qr.valid_from && now < qr.valid_from) {
      throw new GoneException('Este QR code ainda não está válido.');
    }
    if (qr.valid_until && now > qr.valid_until) {
      throw new GoneException('Este QR code expirou.');
    }

    // Uso único já consumido.
    if (qr.usage_mode === 'single' && qr.used_count > 0) {
      throw new GoneException('Este QR code já foi utilizado.');
    }

    return qr;
  }

  /** Marca um uso (chamado quando a chamada do entregador conecta). */
  async registerUse(qrId: string) {
    return this.prisma.qrCode.update({
      where: { id: qrId },
      data: {
        used_count: { increment: 1 },
        used_at: new Date(), // sobrescreve; para "primeiro uso" use updateMany com filtro null
      },
    });
  }

  /**
   * Deriva o estado de exibição de um QR (para as listas Ativos/Expirados ②·9).
   * Puro — não toca o banco.
   */
  isExpired(qr: {
    active: boolean;
    valid_until: Date | null;
    usage_mode: string;
    used_count: number;
  }): boolean {
    if (!qr.active) return true;
    if (qr.valid_until && new Date() > qr.valid_until) return true;
    if (qr.usage_mode === 'single' && qr.used_count > 0) return true;
    return false;
  }
}
