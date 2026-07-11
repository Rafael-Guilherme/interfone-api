import { NestFactory } from '@nestjs/core';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const config = app.get(ConfigService);

  // CORS: app mobile (nativo, sem origin), web admin e web entregador.
  app.enableCors({
    origin: config.get<string>('CORS_ORIGINS')?.split(',') ?? true,
    credentials: true,
  });

  // Validação global de DTOs — casa com os class-validator dos módulos.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // remove props não declaradas no DTO
      forbidNonWhitelisted: true, // 400 se vier prop desconhecida
      transform: true, // instancia os DTOs (habilita defaults/tipos)
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // Versionamento por URL: /v1/...
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  const port = config.get<number>('PORT') ?? 3000;
  await app.listen(port);
}

void bootstrap();
