import express, { type Request, type Response } from 'express';
import { WebSocket } from 'ws';

const app = express();
const router = express.Router();
declare const socket: WebSocket;

app.param((name: string, fn: unknown) => fn); // @uptide param-callback-removed at:app.param
router.param('id', (req, res, next) => next()); // @uptide param-callback-removed keep

app.get('/old', (req, res) => {
  res.redirect('/new', 301); // @uptide redirect-order at:res.redirect
  res.redirect(302, '/new'); // @uptide redirect-order keep
  res.redirect('back'); // @uptide redirect-back at:res.redirect
  res.status(404).send(404); // @uptide send-status-number at:res.status
  res.send('404'); // @uptide send-status-number keep
});

export function gone(req: Request, response: Response) {
  response.location('back'); // @uptide redirect-back at:response.location
  response.send(410); // @uptide send-status-number at:response.send
}

socket.send(1); // @uptide send-status-number keep
const history = { redirect: (to: string, code: number) => [to, code] };
history.redirect('/new', 301); // @uptide redirect-order keep
