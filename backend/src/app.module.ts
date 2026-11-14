import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { WaitlistModule } from './waitlist/waitlist.module.js';

@Module({
  imports: [WaitlistModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
