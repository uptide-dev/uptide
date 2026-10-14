import type { Redis } from 'ioredis';

declare const subscriber: Redis;

export function isSubscribed(): boolean {
  return subscriber.mode === 'subscriber'; // @uptide subscriber-mode at:subscriber.mode
}

export function canQuery(): boolean {
  if ('subscriber' !== subscriber['mode']) return true; // @uptide subscriber-mode at:'subscriber'
  return false;
}

export function describe(): string {
  switch (subscriber.mode) {
    case 'subscriber': // @uptide subscriber-mode at:case
      return 'subscribed';
    case 'normal': // @uptide subscriber-mode keep at:case
      return 'normal';
    default:
      return 'other';
  }
}

// Other properties and plain objects that happen to say "subscriber" are left alone.
export const job = { mode: 'subscriber' }; // @uptide subscriber-mode keep at:mode
export const waiting = subscriber.status === 'subscriber'; // @uptide subscriber-mode keep at:subscriber.status
