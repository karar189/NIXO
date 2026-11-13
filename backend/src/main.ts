import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({
    origin: process.env.FRONTEND_ORIGIN ?? 'http://localhost:3000',
  });
  // BACKEND_PORT (was PORT): renamed so it doesn't clash with the agents in the shared .env.
  await app.listen(process.env.BACKEND_PORT ?? 4000);
}
await bootstrap();
