import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { QrValidationService } from './qr-validation.service';
import { CallsService } from '../calls/calls.service';
import { DeliveryCallDto, LeaveMessageDto } from './dto';

/**
 * Fluxo do entregador — anônimo, sem login, sessão em memória no cliente.
 *
 * Princípio LGPD central: o entregador NUNCA vê dados pessoais de morador.
 * As respostas expõem apenas rótulos de local ("Bloco A", "Unidade 101") e
 * jamais nome, e-mail, telefone ou avatar. Todo shape de saída aqui é
 * deliberadamente reduzido.
 */
@Injectable()
export class DeliveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly qr: QrValidationService,
    private readonly calls: CallsService,
  ) {}

  /**
   * GET /q/:token — resolve o QR e devolve o mínimo para o entregador escolher
   * a unidade. Sem qualquer dado de pessoa.
   */
  async resolve(token: string) {
    const qr = await this.qr.resolveUsable(token);

    // QR de unidade fixa → devolve só aquela unidade.
    if (qr.unit_id && qr.unit) {
      return {
        condo: { id: qr.condominium.id, name: qr.condominium.name },
        scope: 'unit' as const,
        units: [this.unitLabel(qr.unit)],
      };
    }

    // QR geral do condo → lista blocos/unidades para o entregador escolher.
    const units = await this.prisma.unit.findMany({
      where: { condominium_id: qr.condominium.id },
      select: {
        id: true,
        number: true,
        block: { select: { id: true, name: true } },
      },
      orderBy: [{ block: { name: 'asc' } }, { number: 'asc' }],
    });

    return {
      condo: { id: qr.condominium.id, name: qr.condominium.name },
      scope: 'condo' as const,
      units: units.map(
        (u: { id: string; number: string; block: { id: string; name: string } | null }) => ({
          id: u.id,
          label: u.block ? `${u.block.name} · ${u.number}` : u.number,
        }),
      ),
    };
  }

  /**
   * POST /q/:token/call — dispara a chamada para os moradores ativos da unidade.
   * Registra o uso do QR. Retorna o token de mídia do entregador (identidade
   * anônima) e o id da chamada para acompanhar o timeout no cliente.
   */
  async call(token: string, dto: DeliveryCallDto) {
    const qr = await this.qr.resolveUsable(token);

    // A unidade escolhida precisa pertencer ao condo do QR.
    const unit = await this.prisma.unit.findFirst({
      where: { id: dto.unit_id, condominium_id: qr.condominium.id },
      select: { id: true },
    });
    if (!unit) {
      throw new NotFoundException('Unidade não encontrada neste condomínio.');
    }

    // Precisa haver ao menos um morador ativo para tocar.
    const hasActive = await this.prisma.profile.count({
      where: {
        condominium_id: qr.condominium.id,
        status: 'active',
        role: 'resident',
        unit_memberships: { some: { unit_id: dto.unit_id } },
      },
    });
    if (hasActive === 0) {
      throw new UnprocessableEntityException(
        'Não há morador disponível nesta unidade no momento.',
      );
    }

    // Delega a criação da chamada ao domínio de calls (caller_kind=delivery).
    const result = await this.calls.startDelivery(qr.condominium.id, {
      unitId: dto.unit_id,
      media: dto.media,
    });

    await this.qr.registerUse(qr.id);

    return {
      call_id: result.call.id,
      media: result.media, // { token, url } do LiveKit p/ identidade anônima
    };
  }

  /**
   * POST /q/:token/message — ninguém atendeu no timeout. Grava o recado e
   * notifica os moradores da unidade (push é responsabilidade de calls/push).
   */
  async leaveMessage(token: string, dto: LeaveMessageDto) {
    const qr = await this.qr.resolveUsable(token);

    const msg = await this.prisma.missedCallMessage.create({
      data: {
        condominium_id: qr.condominium.id,
        unit_id: dto.unit_id,
        visitor_name: dto.visitor_name ?? null,
        reason: dto.reason,
      },
    });

    return { id: msg.id, created_at: msg.created_at };
  }

  // ---- helpers ----

  private unitLabel(unit: { id: string; number: string; block_id: string | null }) {
    return { id: unit.id, label: unit.number };
  }
}
