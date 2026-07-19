import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { JsonLogger } from './json-logger';

/**
 * Log de acesso das requisições BEM-SUCEDIDAS. As que falham são registradas
 * pelo ExceptionLogFilter — que também pega o que os guards recusam, antes de
 * qualquer interceptor rodar. Assim cada requisição gera exatamente uma linha.
 *
 * O que NÃO entra aqui, de propósito: corpo, query string crua e cabeçalhos.
 * É por ali que trafegam OTP, tokens e dados pessoais.
 */
@Injectable()
export class AccessLogInterceptor implements NestInterceptor {
  private readonly logger = new JsonLogger();

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (ctx.getType() !== 'http') return next.handle();

    const req = ctx.switchToHttp().getRequest();
    const res = ctx.switchToHttp().getResponse();

    return next.handle().pipe(
      tap(() => {
        this.logger.evento('log', 'HTTP', `${req.method} ${req.route?.path ?? req.url} ${res.statusCode}`, {
          request_id: req.requestId,
          method: req.method,
          // Rota-padrão (com :params) em vez da URL crua: agrupa no coletor e
          // não carrega o token do QR nem a query string.
          route: req.route?.path ?? String(req.url).split('?')[0],
          status: res.statusCode,
          duration_ms: req.startedAt ? Date.now() - req.startedAt : undefined,
          user_id: req.user?.userId,
          ip: req.ip,
        });
      }),
    );
  }
}
