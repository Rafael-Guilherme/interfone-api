import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { ManagerAccess } from './manager-access.service';
import {
  BlockDto,
  CreateCondominiumDto,
  JoinDto,
  UnitDto,
  UpdateCondominiumDto,
} from './dto';

/**
 * Cadastro de interfone pelo síndico.
 *
 * Cria, numa transação: o condomínio (endereço + geo), seus blocos/unidades,
 * um QR "Portaria geral" e o Profile do usuário como `manager` com status
 * `pending` — ou seja, o interfone fica aguardando autorização do administrador
 * (super-admin) antes de operar. É esse profile pendente que trava o acesso.
 */
@Injectable()
export class CondominiumsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ManagerAccess,
  ) {}

  async create(userId: string, dto: CreateCondominiumDto) {
    const units = dto.has_blocks ? null : dto.units ?? [];
    const blocks = dto.has_blocks ? dto.blocks ?? [] : null;

    if (dto.has_blocks && (!blocks || blocks.length === 0)) {
      throw new BadRequestException('Informe ao menos um bloco.');
    }
    if (!dto.has_blocks && (!units || units.length === 0)) {
      throw new BadRequestException('Informe ao menos uma unidade.');
    }

    const slug = await this.uniqueSlug(dto.name);
    const join_code = await this.uniqueJoinCode();

    return this.prisma.$transaction(async (tx) => {
      const condo = await tx.condominium.create({
        data: {
          slug,
          join_code,
          name: dto.name,
          photo_url: dto.photo_url ?? null,
          zip_code: dto.zip_code ?? null,
          street: dto.street ?? null,
          street_number: dto.street_number ?? null,
          complement: dto.complement ?? null,
          district: dto.district ?? null,
          city: dto.city ?? null,
          state: dto.state ?? null,
          latitude: dto.geo?.latitude ?? null,
          longitude: dto.geo?.longitude ?? null,
          geo_radius_m: dto.geo?.radius_m ?? null,
          geo_required: !!dto.geo,
          status: 'active',
        },
      });

      if (blocks) {
        for (const b of blocks) {
          const block = await tx.block.create({
            data: { condominium_id: condo.id, name: b.name },
          });
          if (b.units.length) {
            await tx.unit.createMany({
              data: b.units.map((u) => ({
                condominium_id: condo.id,
                block_id: block.id,
                number: u.number,
              })),
            });
          }
        }
      } else if (units) {
        await tx.unit.createMany({
          data: units.map((u) => ({ condominium_id: condo.id, number: u.number })),
        });
      }

      // QR "Portaria geral" já pronto para o entregador escanear.
      const qr = await tx.qrCode.create({
        data: {
          condominium_id: condo.id,
          token: this.randomToken(10),
          kind: 'manager',
          label: 'Portaria geral',
          validity_mode: 'fixed',
          usage_mode: 'unlimited',
          active: true,
        },
      });

      // Profile do síndico — pendente de autorização do administrador.
      const profile = await tx.profile.create({
        data: {
          user_id: userId,
          condominium_id: condo.id,
          role: 'manager',
          status: 'pending',
        },
      });

      const unitCount = await tx.unit.count({ where: { condominium_id: condo.id } });
      return {
        id: condo.id,
        name: condo.name,
        slug: condo.slug,
        join_code: condo.join_code,
        status: condo.status,
        profile_status: profile.status, // 'pending'
        qr_token: qr.token,
        blocks: blocks?.length ?? 0,
        units: unitCount,
      };
    });
  }

  /** Condomínios em que o usuário é gestor (para listar depois). */
  async listMine(userId: string) {
    const profiles = await this.prisma.profile.findMany({
      where: { user_id: userId, role: { in: ['manager', 'sub_manager'] } },
      include: { condominium: true },
      orderBy: { created_at: 'desc' },
    });
    return profiles.map((p) => ({
      profile_status: p.status,
      condominium: {
        id: p.condominium.id,
        name: p.condominium.name,
        slug: p.condominium.slug,
        status: p.condominium.status,
      },
    }));
  }

  /** Painel do síndico: detalhe do condo + estatísticas + QR da portaria. */
  async detail(userId: string, condoId: string) {
    await this.access.assert(userId, condoId);
    const condo = await this.prisma.condominium.findUnique({ where: { id: condoId } });
    if (!condo) throw new NotFoundException('Interfone não encontrado.');

    const [residentsActive, residentsPending, blocks, units, qr] = await Promise.all([
      this.prisma.profile.count({ where: { condominium_id: condoId, role: 'resident', status: 'active' } }),
      this.prisma.profile.count({ where: { condominium_id: condoId, role: 'resident', status: 'pending' } }),
      this.prisma.block.count({ where: { condominium_id: condoId } }),
      this.prisma.unit.count({ where: { condominium_id: condoId } }),
      this.prisma.qrCode.findFirst({ where: { condominium_id: condoId, kind: 'manager' }, orderBy: { created_at: 'asc' } }),
    ]);

    return {
      id: condo.id,
      name: condo.name,
      photo_url: condo.photo_url,
      join_code: condo.join_code,
      slug: condo.slug,
      address: {
        street: condo.street,
        number: condo.street_number,
        district: condo.district,
        city: condo.city,
        state: condo.state,
        zip_code: condo.zip_code,
      },
      geo: condo.geo_radius_m
        ? { latitude: condo.latitude, longitude: condo.longitude, radius_m: condo.geo_radius_m }
        : null,
      counts: { residents_active: residentsActive, residents_pending: residentsPending, blocks, units },
      qr_token: qr?.token ?? null,
    };
  }

  /** Lista moradores do condo (para aprovação). `status` filtra opcionalmente. */
  async listResidents(userId: string, condoId: string, status?: string) {
    await this.access.assert(userId, condoId);
    const profiles = await this.prisma.profile.findMany({
      where: {
        condominium_id: condoId,
        role: 'resident',
        ...(status ? { status: status as any } : {}),
      },
      include: {
        user: { select: { name: true, email: true } },
        unit_memberships: { include: { unit: { include: { block: { select: { name: true } } } } } },
      },
      orderBy: { created_at: 'asc' },
    });

    return profiles.map((p) => ({
      profile_id: p.id,
      name: p.user.name,
      email: p.user.email,
      status: p.status,
      units: p.unit_memberships.map((m) =>
        m.unit.block ? `Bloco ${m.unit.block.name} · ${m.unit.number}` : m.unit.number,
      ),
    }));
  }

  /** Aprova (active) ou rejeita (blocked) um morador pendente. */
  async setResidentStatus(userId: string, condoId: string, profileId: string, action: 'approve' | 'reject') {
    await this.access.assert(userId, condoId);
    const profile = await this.prisma.profile.findFirst({
      where: { id: profileId, condominium_id: condoId, role: 'resident' },
    });
    if (!profile) throw new NotFoundException('Morador não encontrado.');

    const updated = await this.prisma.profile.update({
      where: { id: profile.id },
      data:
        action === 'approve'
          ? { status: 'active', approved_by_id: userId, approved_at: new Date() }
          : { status: 'blocked' },
    });
    return { profile_id: updated.id, status: updated.status };
  }

  // ============================ GESTÃO ============================

  /** Atualiza dados do interfone (nome, foto, endereço, geo). */
  async update(userId: string, condoId: string, dto: UpdateCondominiumDto) {
    await this.access.assert(userId, condoId);
    return this.prisma.condominium.update({
      where: { id: condoId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.photo_url !== undefined ? { photo_url: dto.photo_url } : {}),
        ...(dto.zip_code !== undefined ? { zip_code: dto.zip_code } : {}),
        ...(dto.street !== undefined ? { street: dto.street } : {}),
        ...(dto.street_number !== undefined ? { street_number: dto.street_number } : {}),
        ...(dto.complement !== undefined ? { complement: dto.complement } : {}),
        ...(dto.district !== undefined ? { district: dto.district } : {}),
        ...(dto.city !== undefined ? { city: dto.city } : {}),
        ...(dto.state !== undefined ? { state: dto.state } : {}),
        ...(dto.geo
          ? {
              latitude: dto.geo.latitude,
              longitude: dto.geo.longitude,
              geo_radius_m: dto.geo.radius_m,
              geo_required: true,
            }
          : {}),
      },
      select: { id: true, name: true },
    });
  }

  /** Estrutura para a tela de Gestão: blocos + unidades + nº de moradores. */
  async structure(userId: string, condoId: string) {
    await this.access.assert(userId, condoId);
    const blocks = await this.prisma.block.findMany({
      where: { condominium_id: condoId },
      orderBy: { name: 'asc' },
      include: {
        units: {
          orderBy: { number: 'asc' },
          include: { _count: { select: { memberships: true } } },
        },
      },
    });
    const looseUnits = await this.prisma.unit.findMany({
      where: { condominium_id: condoId, block_id: null },
      orderBy: { number: 'asc' },
      include: { _count: { select: { memberships: true } } },
    });
    const mapUnit = (u: any) => ({ id: u.id, number: u.number, residents: u._count.memberships });
    return {
      has_blocks: blocks.length > 0,
      blocks: blocks.map((b) => ({ id: b.id, name: b.name, units: b.units.map(mapUnit) })),
      units_no_block: looseUnits.map(mapUnit),
    };
  }

  async createBlock(userId: string, condoId: string, dto: BlockDto) {
    await this.access.assert(userId, condoId);
    return this.prisma.block.create({ data: { condominium_id: condoId, name: dto.name }, select: { id: true, name: true } });
  }

  async updateBlock(userId: string, condoId: string, blockId: string, dto: BlockDto) {
    await this.access.assert(userId, condoId);
    await this.ownedBlock(condoId, blockId);
    return this.prisma.block.update({ where: { id: blockId }, data: { name: dto.name }, select: { id: true, name: true } });
  }

  async deleteBlock(userId: string, condoId: string, blockId: string) {
    await this.access.assert(userId, condoId);
    await this.ownedBlock(condoId, blockId);
    const residents = await this.prisma.unitMembership.count({ where: { unit: { block_id: blockId } } });
    if (residents > 0) {
      throw new ConflictException('Há moradores vinculados a unidades deste bloco. Desvincule-os antes de remover.');
    }
    await this.prisma.block.delete({ where: { id: blockId } });
    return { ok: true };
  }

  async createUnit(userId: string, condoId: string, dto: UnitDto) {
    await this.access.assert(userId, condoId);
    if (dto.block_id) await this.ownedBlock(condoId, dto.block_id);
    return this.prisma.unit.create({
      data: { condominium_id: condoId, block_id: dto.block_id ?? null, number: dto.number },
      select: { id: true, number: true, block_id: true },
    });
  }

  async updateUnit(userId: string, condoId: string, unitId: string, dto: UnitDto) {
    await this.access.assert(userId, condoId);
    await this.ownedUnit(condoId, unitId);
    if (dto.block_id) await this.ownedBlock(condoId, dto.block_id);
    return this.prisma.unit.update({
      where: { id: unitId },
      data: { number: dto.number, ...(dto.block_id !== undefined ? { block_id: dto.block_id ?? null } : {}) },
      select: { id: true, number: true, block_id: true },
    });
  }

  async deleteUnit(userId: string, condoId: string, unitId: string) {
    await this.access.assert(userId, condoId);
    await this.ownedUnit(condoId, unitId);
    const residents = await this.prisma.unitMembership.count({ where: { unit_id: unitId } });
    if (residents > 0) {
      throw new ConflictException('Há moradores vinculados a esta unidade. Desvincule-os antes de remover.');
    }
    await this.prisma.unit.delete({ where: { id: unitId } });
    return { ok: true };
  }

  // ===================== ENTRADA DE MORADOR (join) =====================

  /** Resolve um condomínio pelo código (para o morador entrar). */
  async lookupByCode(code: string) {
    const condo = await this.prisma.condominium.findUnique({
      where: { join_code: code.toUpperCase() },
      select: { id: true, name: true, status: true },
    });
    if (!condo || condo.status !== 'active') throw new NotFoundException('Código de condomínio inválido.');
    const units = await this.prisma.unit.findMany({
      where: { condominium_id: condo.id },
      include: { block: { select: { name: true } } },
      orderBy: [{ block: { name: 'asc' } }, { number: 'asc' }],
    });
    return {
      id: condo.id,
      name: condo.name,
      units: units.map((u) => ({ id: u.id, label: u.block ? `Bloco ${u.block.name} · ${u.number}` : u.number })),
    };
  }

  /**
   * Entra num condomínio pelo código. Morador (`as:'resident'`) precisa escolher
   * a unidade e vira `resident` pending; síndico (`as:'manager'`) entra como
   * `sub_manager` pending (sem unidade) — aguardando o gestor/admin autorizar.
   */
  async join(userId: string, condoId: string, dto: JoinDto) {
    const asManager = dto.as === 'manager';
    const role = asManager ? 'sub_manager' : 'resident';

    if (!asManager) {
      if (!dto.unit_id) throw new BadRequestException('Escolha a unidade.');
      const unit = await this.prisma.unit.findFirst({ where: { id: dto.unit_id, condominium_id: condoId } });
      if (!unit) throw new NotFoundException('Unidade não encontrada neste condomínio.');
    }

    const profile = await this.prisma.profile.upsert({
      where: { user_id_condominium_id_role: { user_id: userId, condominium_id: condoId, role } },
      update: {},
      create: { user_id: userId, condominium_id: condoId, role, status: 'pending' },
    });
    if (!asManager && dto.unit_id) {
      await this.prisma.unitMembership.upsert({
        where: { profile_id_unit_id: { profile_id: profile.id, unit_id: dto.unit_id } },
        update: {},
        create: { profile_id: profile.id, unit_id: dto.unit_id },
      });
    }
    return { profile_id: profile.id, status: profile.status, role };
  }

  private async ownedBlock(condoId: string, blockId: string) {
    const b = await this.prisma.block.findFirst({ where: { id: blockId, condominium_id: condoId }, select: { id: true } });
    if (!b) throw new NotFoundException('Bloco não encontrado.');
  }
  private async ownedUnit(condoId: string, unitId: string) {
    const u = await this.prisma.unit.findFirst({ where: { id: unitId, condominium_id: condoId }, select: { id: true } });
    if (!u) throw new NotFoundException('Unidade não encontrada.');
  }

  // ---- helpers ----

  private randomToken(len: number) {
    return randomBytes(len).toString('base64url').slice(0, len);
  }

  private slugify(s: string) {
    return s
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '') // remove acentos
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'interfone';
  }

  private async uniqueSlug(name: string) {
    const base = this.slugify(name);
    for (let i = 0; i < 5; i++) {
      const slug = `${base}-${this.randomToken(4).toLowerCase()}`;
      if (!(await this.prisma.condominium.findUnique({ where: { slug } }))) return slug;
    }
    return `${base}-${Date.now().toString(36)}`;
  }

  private async uniqueJoinCode() {
    for (let i = 0; i < 5; i++) {
      const code = this.randomToken(6).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
      if (code.length === 6 && !(await this.prisma.condominium.findUnique({ where: { join_code: code } }))) {
        return code;
      }
    }
    return randomBytes(4).toString('hex').toUpperCase().slice(0, 6);
  }
}
