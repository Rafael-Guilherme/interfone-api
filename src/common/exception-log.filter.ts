import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { JsonLogger } from './json-logger';

/**
 * Registra TODA exceção HTTP e devolve a resposta padrão do Nest.
 *
 * Existe porque guards rodam antes dos interceptors: sem isto, um 401/403
 * negado por guard nunca apareceria no log de acesso — justamente os eventos
 * que mais interessam para detectar abuso.
 *
 * A mensagem de 5xx não é repassada ao cliente (pode conter detalhe interno);
 * o `request_id` devolvido permite casar o erro do usuário com a linha do log.
 */
@Catch()
export class ExceptionLogFilter implements ExceptionFilter {
  private readonly logger = new JsonLogger();

  catch(exception: unknown, host: ArgumentsHost) {
    if (host.getType() !== 'http') throw exception;

    const ctx = host.switchToHttp();
    const req = ctx.getRequest();
    const res = ctx.getResponse();

    const ehHttp = exception instanceof HttpException;
    const status = ehHttp ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const corpo = ehHttp ? exception.getResponse() : 'Internal server error';

    this.logger.evento(
      status >= 500 ? 'error' : 'warn',
      'HTTP',
      `${req.method} ${req.route?.path ?? req.url} ${status}`,
      {
        request_id: req.requestId,
        method: req.method,
        route: req.route?.path ?? String(req.url).split('?')[0],
        status,
        duration_ms: req.startedAt ? Date.now() - req.startedAt : undefined,
        user_id: req.user?.userId,
        ip: req.ip,
        error: exception instanceof Error ? exception.message : String(exception),
        // Stack só para falhas inesperadas; 4xx são fluxo normal de negócio.
        ...(status >= 500 && exception instanceof Error ? { stack: exception.stack } : {}),
      },
    );

    res.status(status).json(
      typeof corpo === 'string'
        ? { statusCode: status, message: corpo, request_id: req.requestId }
        : { ...(corpo as object), request_id: req.requestId },
    );
  }
}
