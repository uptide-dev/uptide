import Redis from 'ioredis';

// The offline queue is on (the default): commands from "connect" wait for the handshake.
const redis = new Redis({ lazyConnect: true }); // @uptide client-defaults at:new

redis.on('connect', () => void redis.subscribe('updates')); // @uptide offline-queue-connect keep at:redis.on
