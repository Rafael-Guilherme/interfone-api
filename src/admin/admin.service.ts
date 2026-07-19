import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PERMISSOES } from '../condominiums/manager-access.service';

/**
 * Painel do administrador da plataforma.
 *
 * O que "aprovar um condomínio" significa aqui: o Condominium já nasce `active`
 * (é só o cadastro), mas o Profile role=manager nasce `pending`. Enquanto ele
 * estiver pendente o síndico não entra no painel. Aprovar = ativar esses
 * perfis — é exatamente o que o script `npm run approve` fazia à mão.
 */
@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  /** Números do topo do painel. */
  async overview() {
    const semanaAtras = new Date(Date.now() - 7 * 24 * 3600 * 1000);
    const [condos, condosSuspensos, usuarios, sindicosPendentes, moradoresPendentes, chamadas, chamadas7d] =
      await Promise.all([
        this.prisma.condominium.count({ where: { status: 'active' } }),
        this.prisma.condominium.count({ where: { status: 'suspended' } }),
        this.prisma.user.count({ where: { status: 'active' } }),
        this.prisma.profile.count({ where: { role: { in: ['manager', 'sub_manager'] }, status: 'pending' } }),
        this.prisma.profile.count({ where: { role: 'resident', status: 'pending' } }),
        this.prisma.call.count(),
        this.prisma.call.count({ where: { started_at: { gte: semanaAtras } } }),
      ]);
    return {
      condominios: { ativos: condos, suspensos: condosSuspensos },
      usuarios,
      pendentes: { sindicos: sindicosPendentes, moradores: moradoresPendentes },
      chamadas: { total: chamadas, ultimos_7_dias: chamadas7d },
    };
  }

  /**
   * Lista condomínios para o painel. `filtro=pending` traz só os que têm síndico
   * aguardando autorização — a fila de trabalho do admin.
   */
  async condominiums(filtro: 'pending' | 'active' | 'suspended' | 'all' = 'all') {
    const where: Prisma.CondominiumWhereInput =
      filtro === 'pending'
        ? { profiles: { some: { role: { in: ['manager', 'sub_manager'] }, status: 'pending' } } }
        : filtro === 'all'
          ? {}
          : { status: filtro };

    const rows = await this.prisma.condominium.findMany({
      where,
      orderBy: { created_at: 'desc' },
      include: {
        profiles: {
          where: { role: { in: ['manager', 'sub_manager'] } },
          include: { user: { select: { id: true, name: true, email: true, phone: true } } },
        },
        _count: { select: { units: true, blocks: true, profiles: true } },
      },
    });

    return rows.map((c) => ({
      id: c.id,
      nome: c.name,
      slug: c.slug,
      status: c.status,
      cidade: c.city,
      estado: c.state,
      criado_em: c.created_at,
      unidades: c._count.units,
      blocos: c._count.blocks,
      perfis: c._count.profiles,
      gestores: c.profiles.map((p) => ({
        profile_id: p.id,
        user_id: p.user.id,
        nome: p.user.name,
        email: p.user.email,
        telefone: p.user.phone,
        papel: p.role,
        status: p.status,
      })),
      aguardando_aprovacao: c.profiles.some((p) => p.status === 'pending'),
    }));
  }

  /** Aprova/rejeita o síndico, ou suspende/reativa o condomínio. */
  async actOnCondominium(
    adminUserId: string,
    condoId: string,
    action: 'approve' | 'reject' | 'suspend' | 'reactivate',
  ) {
    const condo = await this.prisma.condominium.findUnique({ where: { id: condoId } });
    if (!condo) throw new NotFoundException('Condomínio não encontrado.');

    if (action === 'approve' || action === 'reject') {
      const status = action === 'approve' ? 'active' : 'blocked';
      const { count } = await this.prisma.profile.updateMany({
        where: { condominium_id: condoId, role: { in: ['manager', 'sub_manager'] }, status: 'pending' },
        data: {
          status,
          approved_at: new Date(),
          approved_by_id: adminUserId, // sem FK no schema: guarda o user_id do admin
        },
      });
      if (count === 0) throw new BadRequestException('Nenhum gestor pendente neste condomínio.');
      return { ok: true, action, gestores_afetados: count };
    }

    const status = action === 'suspend' ? 'suspended' : 'active';
    await this.prisma.condominium.update({ where: { id: condoId }, data: { status } });
    return { ok: true, action, status };
  }

  /** Detalhe de um condomínio + todos os usuários vinculados a ele. */
  async condominium(condoId: string) {
    const c = await this.prisma.condominium.findUnique({
      where: { id: condoId },
      include: {
        _count: { select: { units: true, blocks: true, qr_codes: true } },
        profiles: {
          orderBy: [{ role: 'asc' }, { created_at: 'asc' }],
          include: {
            user: { select: { id: true, name: true, email: true, phone: true, status: true, is_super_admin: true } },
            unit_memberships: { include: { unit: { include: { block: { select: { name: true } } } } } },
          },
        },
      },
    });
    if (!c) throw new NotFoundException('Condomínio não encontrado.');

    return {
      id: c.id,
      nome: c.name,
      slug: c.slug,
      join_code: c.join_code,
      status: c.status,
      criado_em: c.created_at,
      endereco: {
        cep: c.zip_code,
        rua: c.street,
        numero: c.street_number,
        complemento: c.complement,
        bairro: c.district,
        cidade: c.city,
        estado: c.state,
      },
      geo: { latitude: c.latitude, longitude: c.longitude, raio_m: c.geo_radius_m, exigido: c.geo_required },
      contadores: { unidades: c._count.units, blocos: c._count.blocks, qr_codes: c._count.qr_codes },
      usuarios: c.profiles.map((p) => {
        const u = p.unit_memberships[0]?.unit;
        return {
          profile_id: p.id,
          user_id: p.user.id,
          nome: p.user.name,
          email: p.user.email,
          telefone: p.user.phone,
          papel: p.role,
          status_perfil: p.status,
          status_usuario: p.user.status,
          is_super_admin: p.user.is_super_admin,
          permissoes: p.permissions,
          unidade: u ? (u.block ? `Bloco ${u.block.name} · ${u.number}` : u.number) : null,
          criado_em: p.created_at,
        };
      }),
    };
  }

  /**
   * Troca o papel de um perfil dentro do condomínio.
   *
   * Promover a `manager` é a transferência de titularidade: os demais gestores
   * titulares do condomínio caem para `sub_manager`, para não ficarem dois
   * "titulares" — `assertOwner` na API trata QUALQUER role=manager como dono.
   * O rebaixado recebe TODAS as permissões de sub-gestor: como titular ele
   * tinha tudo, e a lista dele estava vazia por definição.
   */
  async setProfileRole(condoId: string, profileId: string, role: 'resident' | 'sub_manager' | 'manager') {
    const perfil = await this.prisma.profile.findFirst({
      where: { id: profileId, condominium_id: condoId },
      include: { user: { select: { name: true, email: true } } },
    });
    if (!perfil) throw new NotFoundException('Perfil não encontrado neste condomínio.');
    if (perfil.role === role) throw new BadRequestException('O perfil já tem esse papel.');

    // O schema tem @@unique([user_id, condominium_id, role]): se a pessoa já
    // tem outro perfil com o papel de destino, a troca colidiria.
    const jaTem = await this.prisma.profile.findFirst({
      where: { user_id: perfil.user_id, condominium_id: condoId, role, id: { not: profileId } },
      select: { id: true },
    });
    if (jaTem) {
      throw new BadRequestException(`${perfil.user.name} já possui um perfil de "${role}" neste condomínio.`);
    }

    const rebaixados: string[] = [];
    await this.prisma.$transaction(async (tx) => {
      if (role === 'manager') {
        const outros = await tx.profile.findMany({
          where: { condominium_id: condoId, role: 'manager', id: { not: profileId } },
          include: { user: { select: { name: true } } },
        });
        for (const o of outros) {
          await tx.profile.update({
            where: { id: o.id },
            // O titular tem tudo com a lista VAZIA; rebaixar sem preencher a
            // lista o deixaria sub-gestor sem permissão nenhuma. Damos todas,
            // e o novo titular tira o que quiser.
            data: { role: 'sub_manager', permissions: [...PERMISSOES] },
          });
          rebaixados.push(o.user.name);
        }
      }
      await tx.profile.update({
        where: { id: profileId },
        data: {
          role,
          // Promovido a titular não precisa mais de lista: manager tem tudo.
          ...(role === 'manager' ? { permissions: [] } : {}),
          // Quem vira gestor precisa estar ativo para o painel abrir.
          ...(role !== 'resident' && perfil.status === 'pending' ? { status: 'active' as const } : {}),
        },
      });
    });

    return { ok: true, papel: role, rebaixados };
  }

  /** Busca por nome/e-mail, com filtros opcionais por condomínio e papel. */
  async users(q?: string, limit = 50, condoId?: string, papel?: string) {
    const filtros: Prisma.UserWhereInput[] = [];
    if (q) {
      filtros.push({
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { email: { contains: q, mode: 'insensitive' } },
        ],
      });
    }
    // Os dois filtros de perfil entram no MESMO `some`: com dois `some`
    // separados, um usuário morador no condo A e gestor no B passaria por um
    // filtro "condo A + gestor" sem nunca ter sido gestor do A.
    if (condoId || papel) {
      filtros.push({
        profiles: {
          some: {
            ...(condoId ? { condominium_id: condoId } : {}),
            ...(papel ? { role: papel as Prisma.EnumProfileRoleFilter['equals'] } : {}),
          },
        },
      });
    }
    const where: Prisma.UserWhereInput = filtros.length ? { AND: filtros } : {};
    const rows = await this.prisma.user.findMany({
      where,
      orderBy: { created_at: 'desc' },
      take: Math.min(limit, 200),
      include: {
        profiles: { include: { condominium: { select: { id: true, name: true } } } },
      },
    });
    return rows.map((u) => ({
      id: u.id,
      nome: u.name,
      email: u.email,
      telefone: u.phone,
      status: u.status,
      is_super_admin: u.is_super_admin,
      criado_em: u.created_at,
      perfis: u.profiles.map((p) => ({
        condominio: p.condominium.name,
        condominio_id: p.condominium.id,
        papel: p.role,
        status: p.status,
      })),
    }));
  }

  /**
   * Bloqueia/desbloqueia usuário e concede/revoga admin. As guardas de
   * auto-sabotagem são propositais: um admin não pode se bloquear nem se
   * revogar, o que deixaria o painel sem dono.
   */
  async actOnUser(
    adminUserId: string,
    targetId: string,
    action: 'block' | 'unblock' | 'grant_admin' | 'revoke_admin',
  ) {
    if (targetId === adminUserId && (action === 'block' || action === 'revoke_admin')) {
      throw new BadRequestException('Você não pode aplicar esta ação em si mesmo.');
    }
    const target = await this.prisma.user.findUnique({ where: { id: targetId } });
    if (!target) throw new NotFoundException('Usuário não encontrado.');

    if (action === 'revoke_admin') {
      const restantes = await this.prisma.user.count({
        where: { is_super_admin: true, status: 'active', id: { not: targetId } },
      });
      if (restantes === 0) throw new ForbiddenException('Não é possível revogar o último administrador.');
    }

    const data =
      action === 'block'
        ? { status: 'blocked' as const }
        : action === 'unblock'
          ? { status: 'active' as const }
          : { is_super_admin: action === 'grant_admin' };

    await this.prisma.user.update({ where: { id: targetId }, data });
    return { ok: true, action };
  }
}
