/**
 * Testes de unidade dos serviços. Prisma entra mockado — a suíte roda sem banco,
 * para poder rodar em CI e no meio do desenvolvimento sem depender do Neon.
 *
 * `src/skeleton` fica de fora pelo mesmo motivo do tsconfig: é o handoff antigo,
 * não compila e não faz parte do build.
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  testPathIgnorePatterns: ['/node_modules/', '/skeleton/'],
  collectCoverageFrom: ['**/*.(t|j)s', '!**/skeleton/**', '!**/*.module.ts', '!main.ts'],
  coverageDirectory: '../coverage',
};
