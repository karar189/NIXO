import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { WaitlistController } from './waitlist.controller.js';
import { WaitlistService } from './waitlist.service.js';

describe('WaitlistController', () => {
  let controller: WaitlistController;
  let service: WaitlistService;

  beforeEach(async () => {
    const mod = await Test.createTestingModule({
      controllers: [WaitlistController],
      providers: [WaitlistService],
    }).compile();
    controller = mod.get(WaitlistController);
    service = mod.get(WaitlistService);
  });

  it('accepts a valid email and dedupes case-insensitively', () => {
    expect(controller.join({ email: 'a@b.co' })).toEqual({ ok: true });
    expect(controller.join({ email: ' A@B.co ' })).toEqual({ ok: true });
    expect(service.count()).toBe(1);
  });

  it.each([{}, { email: 'nope' }, { email: 42 }, null])(
    'rejects invalid body %j',
    (body) => {
      expect(() => controller.join(body)).toThrow(BadRequestException);
    },
  );
});
