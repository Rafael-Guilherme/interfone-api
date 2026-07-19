import { Controller, Get, Param, ParseUUIDPipe, Post, Query, Res, UnauthorizedException, UseGuards } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Response } from 'express';
import { ResidentsPdfService } from './residents-pdf.service';
import { CurrentUserId, JwtAuthGuard } from '../common/jwt-auth.guard';

/**
 * Export de moradores em PDF, em duas etapas.
 *
 * Por que não um GET autenticado direto: o app abre o download no navegador do
 * sistema (`Linking.openURL`), que não manda o header Authorization. Em vez de
 * jogar o access token de 7 dias na URL, o app pede um link assinado de 5
 * minutos, com escopo restrito a ESTE condomínio e a ESTA ação.
 */
const TTL_SEGUNDOS = 5 * 60;
const ESCOPO = 'residents_pdf';

@Controller('condominiums')
export class ResidentsPdfController {
  constructor(
    private readonly pdf: ResidentsPdfService,
    private readonly jwt: JwtService,
  ) {}

  /** Gera o link temporário. Exige sessão de gestor (validada ao emitir e ao baixar). */
  @UseGuards(JwtAuthGuard)
  @Post(':id/residents-pdf-link')
  async link(@CurrentUserId() userId: string, @Param('id', ParseUUIDPipe) id: string) {
    await this.pdf.assertAccess(userId, id); // falha cedo se não for gestor
    const t = await this.jwt.signAsync(
      { sub: userId, condo: id, scope: ESCOPO },
      { expiresIn: TTL_SEGUNDOS },
    );
    const base = (process.env.PUBLIC_API_URL ?? '').replace(/\/$/, '');
    return { url: `${base}/condominiums/${id}/residents.pdf?t=${t}`, expira_em_s: TTL_SEGUNDOS };
  }

  /** Download. Público na rota, mas o `t` carrega a autorização. */
  @Get(':id/residents.pdf')
  async download(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('t') t: string,
    @Res() res: Response,
  ) {
    if (!t) throw new UnauthorizedException('Link inválido.');
    let payload: { sub: string; condo: string; scope: string };
    try {
      payload = await this.jwt.verifyAsync(t);
    } catch {
      throw new UnauthorizedException('Link expirado. Gere um novo no app.');
    }
    // O escopo e o condomínio precisam bater: um link não serve para outro condo.
    if (payload.scope !== ESCOPO || payload.condo !== id) {
      throw new UnauthorizedException('Link inválido.');
    }

    const { nome, buffer } = await this.pdf.generate(payload.sub, id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${nome}"`);
    res.setHeader('Content-Length', buffer.length);
    res.end(buffer);
  }
}
