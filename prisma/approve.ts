import { PrismaClient } from '@prisma/client';

/**
 * Aprovação DEV de síndico — simula a autorização do administrador enquanto o
 * painel de super-admin não existe. Marca os perfis manager/sub_manager do
 * usuário como `active`.
 *
 *   npm run approve -- sindico@demo.test
 */
const prisma = new PrismaClient();

async function main() {
  const email = process.argv[2];
  if (!email) {
    console.error('uso: npm run approve -- <email>');
    process.exit(1);
  }
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.error('usuário não encontrado:', email);
    process.exit(1);
  }
  const res = await prisma.profile.updateMany({
    where: { user_id: user.id, role: { in: ['manager', 'sub_manager'] }, status: { not: 'active' } },
    data: { status: 'active', approved_at: new Date() },
  });
  console.log(`✓ aprovado(s) ${res.count} perfil(is) de gestor para ${email}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
