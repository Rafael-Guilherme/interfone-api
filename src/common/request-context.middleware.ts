import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

/**
 * Carimba id de correlação e início da requisição.
 *
 * Precisa ser middleware (e não interceptor): middlewares rodam ANTES dos
 * guards, então um 401/403 negado por guard ainda tem `requestId` para o
 * filtro de exceção registrar.
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: Request & { requestId?: string; startedAt?: number }, res: Response, next: NextFunction) {
    const cabecalho = req.headers['x-request-id'];
    req.requestId = (Array.isArray(cabecalho) ? cabecalho[0] : cabecalho) || randomUUID();
    req.startedAt = Date.now();
    res.setHeader('x-request-id', req.requestId);
    next();
  }
}
