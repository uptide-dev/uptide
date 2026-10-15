import express, { Router } from 'express';
import type { Express } from 'express';

const app = express();
const api = Router();
const cache = new Map<string, string>();

app.get('*', serve); // @uptide route-syntax
app.use('/assets/*', serve); // @uptide route-syntax
api.get('/users/:id?', serve); // @uptide route-syntax
api.post('/files/:name.:ext?', serve); // @uptide route-syntax
app.get('/ab+cd', serve); // @uptide route-syntax
app.get(['/', '/docs/(.*)'], serve); // @uptide route-syntax
app
  .route('/book/:id?') // @uptide route-syntax
  .get(serve);
app.get('/users/:id', serve); // @uptide route-syntax keep
app.get(/.*fly$/, serve); // @uptide route-syntax keep
cache.get('*'); // @uptide route-syntax keep
api.delete(`/items/${'x'}/:id`, serve); // @uptide route-syntax keep

export function mount(server: Express) {
  server.all('/proxy/*', serve); // @uptide route-syntax
}

class Server {
  private readonly app = express();
  start() {
    this.app.get('/health/*', serve); // @uptide route-syntax
  }
}

const proxied = [
  '/rest', // @uptide route-syntax keep
  '/images/*', // @uptide route-syntax
  '/static/*', // @uptide route-syntax keep
];
for (const path of proxied) app.all(path, serve);
let mutable = '/later/*'; // @uptide route-syntax keep
app.get(mutable, serve);
mutable = '/x';

export function mountProxies(router = Router()) {
  const forwarded = [
    '/api', // @uptide route-syntax keep
    '/rest*', // @uptide route-syntax
  ];
  for (const path of forwarded) {
    router.all(path, serve);
  }
}

function serve() {}
export { Server };
