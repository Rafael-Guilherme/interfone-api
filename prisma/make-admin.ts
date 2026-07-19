import { PrismaClient } from '@prisma/client';

/**
 * Promove um usuário a administrador da plataforma.
 *
 *   npm run make-admin -- admin@interfone.app
 *
 * Existe porque o primeiro admin não tem quem o crie pelo painel (ovo e galinha).
 * Depois do primeiro, a promoção é feita pela própria tela de usuários.
 */
const prisma = new PrismaClient();

async function main() {
  const email = process.argv[2];
  if (!email) {
    console.error('uso: npm run make-admin -- <email>');
    process.exit(1);
  }
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.error(`usuário não encontrado: ${email}`);
    console.error('dica: faça um request-otp com esse e-mail primeiro para criá-lo.');
    process.exit(1);
  }
  await prisma.user.update({ where: { id: user.id }, data: { is_super_admin: true } });
  console.log(`✔ ${email} agora é administrador da plataforma.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
