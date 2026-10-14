{
  "name": "api",
  "type": "module",
  "scripts": {
    "start": "node --require ./instrument.cjs dist/server.js", // @uptide require-preload at:"start"
    "start:otel": "node -r @sentry/node/preload dist/server.js", // @uptide require-preload at:"start:otel"
    "start:env": "node -r dotenv/config dist/server.js", // @uptide require-preload keep at:"start:env"
    "dev": "node --import ./instrument.mjs --watch src/server.ts" // @uptide require-preload keep at:"dev"
  }
}
