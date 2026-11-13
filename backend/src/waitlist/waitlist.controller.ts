import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Post,
} from '@nestjs/common';
import { WaitlistService } from './waitlist.service.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

@Controller('waitlist')
export class WaitlistController {
  constructor(private readonly waitlist: WaitlistService) {}

  @Post()
  @HttpCode(200)
  join(@Body() body: unknown): { ok: true } {
    const email =
      typeof body === 'object' && body !== null && 'email' in body
        ? (body as { email: unknown }).email
        : undefined;
    if (
      typeof email !== 'string' ||
      email.length > 254 ||
      !EMAIL_RE.test(email.trim())
    ) {
      throw new BadRequestException('Please enter a valid email address.');
    }
    this.waitlist.add(email);
    return { ok: true };
  }
}
