import { LoggerService, LogLevel } from '@nestjs/common';

/**
 * Logger estruturado: uma linha JSON por evento, para o coletor da hospedagem
 * conseguir filtrar/agrupar. Em desenvolvimento cai no formato legível, que é
 * melhor para ler no terminal.
 *
 * Regra de ouro: nada de segredo aqui. Códigos OTP, tokens JWT, chaves de API e
 * senhas nunca devem chegar ao log — `redigir()` é a última linha de defesa
 * contra um objeto de contexto passar isso sem querer.
 */

const CAMPOS_SENSIVEIS =
  /^(pass|senha|password|token|access|refresh|authorization|auth|code|codigo|otp|devcode|secret|api[_-]?key|geo_?pass|jwt)$/i;

/** Mascara campos sensíveis, recursivamente, sem alterar o objeto original. */
export function redigir(valor: unknown, profundidade = 0): unknown {
  if (profundidade > 4 || valor === null || valor === undefined) return valor;
  if (Array.isArray(valor)) return valor.map((v) => redigir(v, profundidade + 1));
  if (typeof valor !== 'object') return valor;

  const saida: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(valor as Record<string, unknown>)) {
    saida[k] = CAMPOS_SENSIVEIS.test(k) ? '[redigido]' : redigir(v, profundidade + 1);
  }
  return saida;
}

export class JsonLogger implements LoggerService {
  private readonly json = process.env.LOG_FORMAT
    ? process.env.LOG_FORMAT === 'json'
    : process.env.NODE_ENV === 'production';

  private readonly nivelMinimo = (process.env.LOG_LEVEL ?? 'log') as LogLevel;
  private static readonly ORDEM: LogLevel[] = ['verbose', 'debug', 'log', 'warn', 'error'];

  private habilitado(nivel: LogLevel) {
    return JsonLogger.ORDEM.indexOf(nivel) >= JsonLogger.ORDEM.indexOf(this.nivelMinimo);
  }

  private escrever(nivel: LogLevel, mensagem: unknown, contexto?: string, extra?: unknown) {
    if (!this.habilitado(nivel)) return;

    if (!this.json) {
      const ctx = contexto ? `[${contexto}] ` : '';
      const linha = `${nivel.toUpperCase().padEnd(7)} ${ctx}${this.texto(mensagem)}`;
      (nivel === 'error' ? console.error : console.log)(linha, extra ? redigir(extra) : '');
      return;
    }

    const evento = {
      ts: new Date().toISOString(),
      level: nivel,
      ctx: contexto,
      msg: this.texto(mensagem),
      ...(extra && typeof extra === 'object' ? (redigir(extra) as object) : {}),
    };
    const linha = JSON.stringify(evento);
    (nivel === 'error' ? console.error : console.log)(linha);
  }

  private texto(m: unknown) {
    if (typeof m === 'string') return m;
    if (m instanceof Error) return m.message;
    try {
      return JSON.stringify(redigir(m));
    } catch {
      return String(m);
    }
  }

  log(mensagem: unknown, contexto?: string) {
    this.escrever('log', mensagem, contexto);
  }
  error(mensagem: unknown, stack?: string, contexto?: string) {
    this.escrever('error', mensagem, contexto, stack ? { stack } : undefined);
  }
  warn(mensagem: unknown, contexto?: string) {
    this.escrever('warn', mensagem, contexto);
  }
  debug(mensagem: unknown, contexto?: string) {
    this.escrever('debug', mensagem, contexto);
  }
  verbose(mensagem: unknown, contexto?: string) {
    this.escrever('verbose', mensagem, contexto);
  }

  /** Evento com campos próprios — usado pelo log de acesso HTTP. */
  evento(nivel: LogLevel, contexto: string, mensagem: string, campos: Record<string, unknown>) {
    this.escrever(nivel, mensagem, contexto, campos);
  }
}
