import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { JsonLogger } from './common/json-logger';
import { AccessLogInterceptor } from './common/access-log.interceptor';
import { ExceptionLogFilter } from './common/exception-log.filter';

async function bootstrap() {
  // JSON em produção, legível em dev (ver JsonLogger / LOG_FORMAT).
  const app = await NestFactory.create(AppModule, { logger: new JsonLogger() });
  // Cabeçalhos de segurança. A API não serve HTML, então a CSP padrão do
  // helmet só atrapalharia respostas de erro — o resto (HSTS, noSniff,
  // frameguard, etc.) fica ativo.
  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: false }));
  app.useGlobalInterceptors(new AccessLogInterceptor());
  app.useGlobalFilters(new ExceptionLogFilter());

  // Em produção, restringe às origens declaradas; em dev, reflete qualquer origem
  // (app nativo não manda Origin; Expo Web/entregador vêm de portas variadas).
  const isProd = process.env.NODE_ENV === 'production';
  app.enableCors({
    origin: isProd ? (process.env.CORS_ORIGINS?.split(',') ?? false) : true,
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  new Logger('Bootstrap').log(`Interfone API em http://localhost:${port}  ·  WS /calls`);
}

void bootstrap();
