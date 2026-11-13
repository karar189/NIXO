import { Injectable } from '@nestjs/common';

// In-memory store for now; swap for a database when persistence is needed.
@Injectable()
export class WaitlistService {
  private readonly emails = new Set<string>();

  add(email: string): { added: boolean } {
    const normalized = email.trim().toLowerCase();
    if (this.emails.has(normalized)) return { added: false };
    this.emails.add(normalized);
    return { added: true };
  }

  count(): number {
    return this.emails.size;
  }
}
