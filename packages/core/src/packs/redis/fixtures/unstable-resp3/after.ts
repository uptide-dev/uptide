import { createClient } from 'redis';

export const client = createClient({ // @uptide client-defaults
  RESP: 3,
  commandOptions: { timeout: undefined },
});
