import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { PrismaService } from '../prisma/prisma.service';
import { ManagerAccess } from './manager-access.service';

/**
 * Export em PDF da lista de moradores, gerado no próprio request.
 *
 * O plano previa um worker BullMQ, mas a lista de um condomínio são dezenas a
 * poucas centenas de linhas — gera em milissegundos e evita depender de Redis.
 * Se algum dia um condomínio ficar grande a ponto de segurar o request, aí sim
 * vale mover para fila.
 */
@Injectable()
export class ResidentsPdfService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly manager: ManagerAccess,
  ) {}

  /** Mesma checagem de gestor usada ao emitir o link e ao baixar. */
  async assertAccess(userId: string, condoId: string) {
    await this.manager.assert(userId, condoId, 'residents');
  }

  async generate(userId: string, condoId: string): Promise<{ nome: string; buffer: Buffer }> {
    await this.manager.assert(userId, condoId, 'residents');

    const [condo, profiles] = await Promise.all([
      this.prisma.condominium.findUnique({
        where: { id: condoId },
        select: { name: true, city: true, state: true },
      }),
      this.prisma.profile.findMany({
        where: { condominium_id: condoId, role: 'resident' },
        include: {
          user: { select: { name: true, email: true, phone: true } },
          unit_memberships: { include: { unit: { include: { block: { select: { name: true } } } } } },
        },
        orderBy: { created_at: 'asc' },
      }),
    ]);

    const linhas = profiles.map((p) => ({
      nome: p.user.name,
      contato: p.user.phone ?? p.user.email,
      unidade:
        p.unit_memberships
          .map((m) => (m.unit.block ? `${m.unit.block.name}·${m.unit.number}` : m.unit.number))
          .join(', ') || '—',
      status: p.status,
    }));

    const buffer = await this.render(condo?.name ?? 'Condomínio', condo?.city, condo?.state, linhas);
    const slug = (condo?.name ?? 'condominio').toLowerCase().replace(/[^a-z0-9]+/g, '-');
    return { nome: `moradores-${slug}.pdf`, buffer };
  }

  /** Desenha o documento e resolve com o Buffer completo. */
  private render(
    condoNome: string,
    cidade: string | null | undefined,
    estado: string | null | undefined,
    linhas: { nome: string; contato: string; unidade: string; status: string }[],
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 40 });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // Cabeçalho
      doc.fontSize(18).text('Lista de moradores', { continued: false });
      doc.fontSize(12).fillColor('#555').text(condoNome);
      if (cidade || estado) doc.text([cidade, estado].filter(Boolean).join('/'));
      doc.text(`Gerado em ${new Date().toLocaleString('pt-BR')} · ${linhas.length} morador(es)`);
      doc.moveDown(1);

      // Tabela simples: larguras fixas, quebra de página manual.
      const COLS = [
        { titulo: 'Nome', x: 40, w: 160 },
        { titulo: 'Unidade', x: 200, w: 110 },
        { titulo: 'Contato', x: 310, w: 175 },
        { titulo: 'Status', x: 485, w: 70 },
      ];
      const LIMITE_Y = 780;

      const cabecalho = () => {
        doc.fontSize(10).fillColor('#000');
        COLS.forEach((c) => doc.text(c.titulo, c.x, doc.y, { width: c.w, continued: false }));
        const y = doc.y + 2;
        doc.moveTo(40, y).lineTo(555, y).strokeColor('#CCC').stroke();
        doc.moveDown(0.4);
      };

      cabecalho();
      doc.fontSize(9).fillColor('#333');

      for (const l of linhas) {
        if (doc.y > LIMITE_Y) {
          doc.addPage();
          cabecalho();
          doc.fontSize(9).fillColor('#333');
        }
        const y = doc.y;
        doc.text(l.nome, COLS[0].x, y, { width: COLS[0].w });
        doc.text(l.unidade, COLS[1].x, y, { width: COLS[1].w });
        doc.text(l.contato, COLS[2].x, y, { width: COLS[2].w });
        doc.text(l.status, COLS[3].x, y, { width: COLS[3].w });
        doc.moveDown(0.5);
      }

      if (linhas.length === 0) {
        doc.text('Nenhum morador cadastrado.', 40, doc.y);
      }

      doc.end();
    });
  }
}
