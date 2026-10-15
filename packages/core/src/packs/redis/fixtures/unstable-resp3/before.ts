import { createClient } from 'redis';

export const client = createClient({ // @uptide client-defaults
  RESP: 3,
  unstableResp3: true, // @uptide unstable-resp3
  commandOptions: { timeout: undefined },
});
