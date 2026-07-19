import { Injectable, Logger } from '@nestjs/common';
import { createTransport, Transporter } from 'nodemailer';

/**
 * Envio de e-mail por SMTP.
 *
 * De propósito não usa SDK de provedor: com SMTP puro, trocar Resend por Brevo,
 * SES, Mailtrap ou o servidor do cliente é só mexer nas variáveis de ambiente,
 * sem tocar em código.
 *
 * Sem `MAIL_HOST`/`MAIL_USER` configurados o serviço entra em modo "log":
 * registra e devolve `sent: false`. Isso mantém o desenvolvimento rodando sem
 * credencial, mas em produção o `AuthService` trata `sent: false` como falha —
 * melhor recusar o login do que fingir que o código foi enviado.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: Transporter | null;
  private readonly from: string;

  constructor() {
    const host = process.env.MAIL_HOST;
    const user = process.env.MAIL_USER;
    const pass = process.env.MAIL_PASSWORD;
    const port = Number(process.env.MAIL_PORT ?? 587);
    const address = process.env.MAIL_FROM ?? 'no-reply@interfone.app';
    const name = process.env.MAIL_NAME ?? 'Interfone';

    // Remetente no formato "Nome <endereco>"; aspas evitam quebrar o cabeçalho
    // se o nome tiver vírgula ou acento.
    this.from = `"${name.replace(/"/g, '')}" <${address}>`;

    const configurado = this.valida(host) && this.valida(user) && this.valida(pass);
    this.transporter = configurado
      ? createTransport({
          host,
          port,
          // 465 = TLS implícito; 587/25 = STARTTLS negociado depois do EHLO.
          secure: port === 465,
          auth: { user: user!, pass: pass! },
        })
      : null;

    if (!this.transporter) {
      this.logger.warn('SMTP não configurado (MAIL_HOST/MAIL_USER/MAIL_PASSWORD) — e-mails só no log.');
    } else {
      this.logger.log(`SMTP pronto: ${host}:${port} como ${address}`);
    }
  }

  /** Rejeita vazio e os placeholders herdados do .env.example. */
  private valida(v?: string) {
    return !!v && !/^(smtp\.exemplo|sua-|seu-|troque|chave-|xxx)/i.test(v);
  }

  isConfigured() {
    return this.transporter !== null;
  }

  /** Envia o código de acesso. Nunca registra o código quando há envio real. */
  async sendOtp(to: string, code: string): Promise<{ sent: boolean; error?: string }> {
    return this.send(to, `${code} é o seu código de acesso ao Interfone`, {
      text: this.textoOtp(code),
      html: this.htmlOtp(code),
      // Só para o fallback de log fora de produção.
      segredoParaLog: code,
    });
  }

  /** Envio genérico — serve para avisos/encomendas quando forem por e-mail. */
  async send(
    to: string,
    subject: string,
    corpo: { text: string; html?: string; segredoParaLog?: string },
  ): Promise<{ sent: boolean; error?: string }> {
    if (!this.transporter) {
      // O segredo só pode aparecer no log FORA de produção. Em produção, um
      // ambiente sem SMTP é erro de configuração — e registrar o código
      // entregaria a credencial de acesso a quem lê os logs.
      if (process.env.NODE_ENV === 'production') {
        this.logger.error(`SMTP não configurado; e-mail para ${to} não foi enviado.`);
      } else {
        this.logger.log(`[modo log] para ${to}: ${corpo.segredoParaLog ?? subject}`);
      }
      return { sent: false, error: 'smtp_not_configured' };
    }

    try {
      await this.transporter.sendMail({
        from: this.from,
        to,
        subject,
        text: corpo.text,
        html: corpo.html,
      });
      this.logger.log(`E-mail enviado para ${to}`); // sem assunto nem conteúdo
      return { sent: true };
    } catch (e) {
      this.logger.error(`Falha ao enviar e-mail para ${to}: ${(e as Error).message}`);
      return { sent: false, error: (e as Error).message };
    }
  }

  /** Checagem de conectividade — útil no /health e ao trocar de provedor. */
  async verificarConexao(): Promise<boolean> {
    if (!this.transporter) return false;
    try {
      await this.transporter.verify();
      return true;
    } catch (e) {
      this.logger.error(`SMTP não respondeu: ${(e as Error).message}`);
      return false;
    }
  }

  private textoOtp(code: string) {
    return [
      'Seu código de acesso ao Interfone:',
      '',
      code,
      '',
      'O código vale por 10 minutos e só pode ser usado uma vez.',
      'Se você não pediu este código, ignore este e-mail.',
    ].join('\n');
  }

  private htmlOtp(code: string) {
    return `
<div style="font-family:Inter,system-ui,sans-serif;max-width:420px;margin:0 auto;padding:24px;color:#14161C">
  <p style="font-size:15px;margin:0 0 20px">Seu código de acesso ao <strong>Interfone</strong>:</p>
  <div style="font-size:34px;font-weight:700;letter-spacing:8px;text-align:center;
              background:#F7F8FB;border:1px solid #E4E6EB;border-radius:14px;padding:18px">${code}</div>
  <p style="font-size:13px;color:#8A8F9C;margin:20px 0 0">
    O código vale por 10 minutos e só pode ser usado uma vez.
  </p>
  <p style="font-size:13px;color:#8A8F9C;margin:8px 0 0">
    Se você não pediu este código, pode ignorar este e-mail.
  </p>
</div>`.trim();
  }
}
