import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';

/** Escopo do passe de geolocalização (não serve para mais nada). */
const GEO_SCOPE = 'geo_pass';

/**
 * Fluxo do entregador — anônimo, sem login. Só rótulos de local (LGPD):
 * nenhum nome/telefone/e-mail de morador é exposto aqui.
 *
 * A posição enviada pelo navegador é conferida NO SERVIDOR; o cliente recebe
 * apenas um passe assinado de curta duração, que o signaling exige depois.
 * A coordenada em si não é armazenada.
 */
@Injectable()
export class DeliveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  /** Valida o token do QR e garante que está utilizável agora. */
  async resolveQr(token: string) {
    const qr = await this.prisma.qrCode.findUnique({
      where: { token },
      include: {
        condominium: {
          select: {
            id: true,
            name: true,
            status: true,
            latitude: true,
            longitude: true,
            geo_radius_m: true,
            geo_required: true,
          },
        },
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

  /**
   * O interfone exige cerca virtual? Só quando há um centro E um raio
   * cadastrados — sem coordenada não há como medir distância, e bloquear todo
   * mundo num condomínio que nunca configurou raio quebraria o que já funciona.
   */
  private geofenceDe(condo: {
    latitude: unknown;
    longitude: unknown;
    geo_radius_m: number | null;
  }) {
    const lat = condo.latitude === null ? null : Number(condo.latitude);
    const lng = condo.longitude === null ? null : Number(condo.longitude);
    const raio = condo.geo_radius_m;
    if (lat === null || lng === null || !raio || Number.isNaN(lat) || Number.isNaN(lng)) return null;
    return { lat, lng, raio };
  }

  /** Distância em metros pela fórmula de haversine. */
  private distanciaM(aLat: number, aLng: number, bLat: number, bLng: number) {
    const R = 6_371_000;
    const rad = (g: number) => (g * Math.PI) / 180;
    const dLat = rad(bLat - aLat);
    const dLng = rad(bLng - aLng);
    const h =
      Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  /**
   * GET /q/:token — condo + unidades para o entregador escolher.
   *
   * Quando o interfone tem cerca virtual, as unidades NÃO vêm até a posição ser
   * validada: a resposta traz `geo.required` e a web pede a localização antes
   * de seguir. Assim a lista de unidades (que é informação do condomínio) nunca
   * chega a quem está fora do raio.
   */
  async resolve(token: string, pos?: { lat: number; lng: number }) {
    const qr = await this.resolveQr(token);
    const cerca = this.geofenceDe(qr.condominium);
    const base = { condo: { id: qr.condominium.id, name: qr.condominium.name } };

    if (cerca) {
      if (!pos) {
        return {
          ...base,
          scope: 'condo' as const,
          geo: { required: true, radius_m: cerca.raio },
          units: [],
        };
      }
      const distancia = this.distanciaM(pos.lat, pos.lng, cerca.lat, cerca.lng);
      if (distancia > cerca.raio) {
        throw new ForbiddenException(
          `Você está a ${Math.round(distancia)} m do condomínio. ` +
            `É preciso estar a até ${cerca.raio} m para chamar.`,
        );
      }
    }

    const units =
      qr.unit_id && qr.unit
        ? [this.unitLabel(qr.unit)]
        : (
            await this.prisma.unit.findMany({
              where: { condominium_id: qr.condominium.id },
              include: { block: { select: { name: true } } },
              orderBy: [{ block: { name: 'asc' } }, { number: 'asc' }],
            })
          ).map((u) => this.unitLabel(u));

    return {
      ...base,
      scope: (qr.unit_id ? 'unit' : 'condo') as 'unit' | 'condo',
      geo: cerca ? { required: true, radius_m: cerca.raio, verified: true } : { required: false },
      units,
      // Passe curto que o socket exige quando há cerca — impede que um cliente
      // pule a verificação conectando direto no signaling.
      ...(cerca ? { geo_pass: await this.emitirPasse(qr.condominium.id) } : {}),
    };
  }

  /** Passe de 10 min provando que a posição foi validada para este condomínio. */
  private async emitirPasse(condoId: string) {
    return this.jwt.signAsync({ condo: condoId, scope: GEO_SCOPE }, { expiresIn: 600 });
  }

  /** Confere o passe apresentado no handshake do socket. */
  async validarPasse(condoId: string, passe?: string) {
    try {
      const p = await this.jwt.verifyAsync(passe ?? '');
      return p.scope === GEO_SCOPE && p.condo === condoId;
    } catch {
      return false;
    }
  }

  /** Este condomínio exige cerca virtual? Usado pelo gateway de chamadas. */
  async exigeGeo(condoId: string) {
    const condo = await this.prisma.condominium.findUnique({
      where: { id: condoId },
      select: { latitude: true, longitude: true, geo_radius_m: true, geo_required: true },
    });
    return condo ? this.geofenceDe(condo) !== null : false;
  }

  /**
   * POST /q/:token/recado — "ninguém atendeu, fica o recado".
   *
   * O QR é a credencial, então a unidade informada precisa pertencer ao condo
   * daquele QR; um QR de unidade só aceita recado para a própria unidade.
   * O morador lê isso em Recados (resident.service.recados).
   */
  async leaveMessage(
    token: string,
    input: { unit_id?: string; visitor_name?: string; reason: string },
  ) {
    const qr = await this.resolveQr(token);

    let unitId: string | null = null;
    if (qr.unit_id) {
      // QR preso a uma unidade: ignora o que veio do cliente e usa a do QR.
      unitId = qr.unit_id;
    } else if (input.unit_id) {
      const unit = await this.prisma.unit.findFirst({
        where: { id: input.unit_id, condominium_id: qr.condominium.id },
        select: { id: true },
      });
      if (!unit) throw new NotFoundException('Unidade inválida.');
      unitId = unit.id;
    }

    const msg = await this.prisma.missedCallMessage.create({
      data: {
        condominium_id: qr.condominium.id,
        unit_id: unitId,
        visitor_name: input.visitor_name?.trim() || null,
        reason: input.reason.trim(),
      },
      select: { id: true, created_at: true },
    });
    return { ok: true, id: msg.id, created_at: msg.created_at };
  }

  private unitLabel(u: { id: string; number: string; block: { name: string } | null }) {
    return { id: u.id, label: u.block ? `Bloco ${u.block.name} · ${u.number}` : u.number };
  }
}
