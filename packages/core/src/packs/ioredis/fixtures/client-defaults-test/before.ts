import Redis from 'ioredis';

// A test's client talks to a test server: its wire defaults are not the application's.
export const client = new Redis(); // @uptide client-defaults keep at:new
