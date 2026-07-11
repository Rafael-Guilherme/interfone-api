import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

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
