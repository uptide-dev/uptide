import Redis from 'ioredis';

const redis = new Redis({ enableOfflineQueue: false }); // @uptide client-defaults at:new

redis.on('connect', () => { // @uptide offline-queue-connect at:redis.on
  void redis.subscribe('updates');
});

redis.once('connect', function () { // @uptide offline-queue-connect at:redis.once
  redis.client('SETNAME', 'worker');
});

// Listeners that send nothing, and commands sent once the client is ready, are left alone.
redis.on('connect', () => console.log('connected')); // @uptide offline-queue-connect keep at:redis.on
redis.on('connect', () => redis.removeAllListeners('message')); // @uptide offline-queue-connect keep at:redis.on
redis.on('ready', () => void redis.subscribe('updates')); // @uptide offline-queue-connect keep at:redis.on
