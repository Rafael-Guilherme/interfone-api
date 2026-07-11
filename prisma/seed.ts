import { PrismaClient } from '@prisma/client';

/**
 * Seed do condomínio de demonstração — idempotente.
 * Recria o condo `demo` (cascata apaga blocos/unidades/perfis/QRs) e garante
 * os usuários moradores com perfil ATIVO e vínculo de unidade, para dar pra
 * testar o fluxo de chamada real (web entregador → app morador) contra o banco.
 */
const prisma = new PrismaClient();

const RESIDENTS = [
  { email: 'ana@demo.test', name: 'Ana Morador', unit: '101', block: 'A' },
  { email: 'bruno@demo.test', name: 'Bruno Morador', unit: '102', block: 'A' },
  { email: 'carla@demo.test', name: 'Carla Morador', unit: '201', block: 'B' },
];

async function main() {
  // Zera o condo demo (cascata). Usuários são preservados e re-upsertados.
  await prisma.condominium.deleteMany({ where: { slug: 'demo' } });

  const condo = await prisma.condominium.create({
    data: {
      slug: 'demo',
      join_code: 'DEMO123',
      name: 'Residencial Demo',
      street: 'Rua das Flores, 100',
      city: 'São Paulo',
      state: 'SP',
      status: 'active',
    },
  });

  const blockA = await prisma.block.create({ data: { condominium_id: condo.id, name: 'A' } });
  const blockB = await prisma.block.create({ data: { condominium_id: condo.id, name: 'B' } });
  const blocks: Record<string, string> = { A: blockA.id, B: blockB.id };

  // QR "geral" da portaria (unit_id null → o entregador escolhe a unidade na web).
  await prisma.qrCode.create({
    data: {
      condominium_id: condo.id,
      token: 'demo',
      kind: 'manager',
      label: 'Portaria geral',
      validity_mode: 'fixed',
      usage_mode: 'unlimited',
      active: true,
    },
  });

  const now = new Date();
  for (const r of RESIDENTS) {
    const unit = await prisma.unit.create({
      data: { condominium_id: condo.id, block_id: blocks[r.block], number: r.unit },
    });

    const user = await prisma.user.upsert({
      where: { email: r.email },
      update: { name: r.name, email_verified_at: now },
      create: { email: r.email, name: r.name, email_verified_at: now, status: 'active' },
    });

    const profile = await prisma.profile.upsert({
      where: {
        user_id_condominium_id_role: {
          user_id: user.id,
          condominium_id: condo.id,
          role: 'resident',
        },
      },
      update: { status: 'active', approved_at: now },
      create: {
        user_id: user.id,
        condominium_id: condo.id,
        role: 'resident',
        status: 'active',
        approved_at: now,
      },
    });

    await prisma.unitMembership.create({
      data: { profile_id: profile.id, unit_id: unit.id },
    });

    console.log(`  ✓ ${r.name}  <${r.email}>  → Bloco ${r.block} · ${r.unit}`);
  }

  console.log(`\nCondomínio "${condo.name}"  slug=${condo.slug}  join_code=${condo.join_code}`);
  console.log(`QR da portaria: token "demo"  →  /q/demo`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
