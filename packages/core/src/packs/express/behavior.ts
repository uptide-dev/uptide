import { satisfies } from '../../fetch/range.js';
import type { BehaviorNote } from '../contract.js';
import type { PackContext } from '../types.js';
import { redirectBackSites, sendStatusSites } from './detect.js';

/** The `engines.node` range a workspace's package.json declares, if any. */
function nodeRange(context: PackContext): { file: string; range: string } | undefined {
  for (const entry of context.inventory ?? []) {
    if (!/(?:^|\/)package\.json$/.test(entry.file)) continue;
    try {
      const range = (JSON.parse(entry.text) as { engines?: { node?: unknown } }).engines?.node;
      if (typeof range === 'string') return { file: entry.file, range };
    } catch {
      // A manifest that does not parse says nothing about Node.
    }
  }
  return undefined;
}

export const expressBehavior: BehaviorNote[] = [
  {
    id: 'redirect-back',
    summary:
      "`res.redirect('back')` and `res.location('back')` no longer read the Referrer: Express 5 redirects to a relative URL named `back`",
    reported: ['finding'],
    severity: 'breaking',
    detect: (text) => redirectBackSites(text),
  },
  {
    id: 'send-status-number',
    summary:
      '`res.send(<number>)` no longer sets the status: Express 5 sends the number as the body with status 200; use `res.sendStatus(code)`',
    reported: ['finding'],
    severity: 'breaking',
    detect: (text) => sendStatusSites(text),
  },
  {
    id: 'async-errors',
    summary:
      'a rejected promise or an error thrown in an async handler now reaches the error middleware (`next(err)`), where Express 4 left it unhandled: error responses, logging and process crashes change where handlers relied on that, and wrappers such as express-async-errors or asyncHandler become redundant',
    reported: ['decision'],
  },
  {
    id: 'req-body-undefined',
    summary:
      '`req.body` is `undefined`, not `{}`, when no body parser ran (body-parser 2): code and tests that read or assert on it without a parser change',
    reported: ['decision', 'test-follow-up'],
  },
  {
    id: 'query-parser',
    summary:
      "`req.query` is parsed with the `simple` parser by default (no nested `a[b]=1` objects or arrays from brackets; Express 4 used `extended`), and it is a getter: assigning to it throws and changes to it are lost; `app.set('query parser', 'extended')` restores the old parsing",
    reported: ['decision'],
  },
  {
    id: 'urlencoded-extended',
    summary:
      '`express.urlencoded()` defaults to `extended: false` (body-parser 2): form fields with brackets stay flat strings unless `extended: true` is set',
    reported: ['decision'],
  },
  {
    id: 'static-dotfiles',
    summary:
      '`express.static` and `res.sendFile` ignore every path segment that starts with a dot by default (send 1.x), where Express 4 served dot-directories such as `/.well-known/`: serve those with their own `express.static` and `dotfiles: "allow"` rather than allowing dotfiles everywhere',
    reported: ['decision'],
  },
  {
    id: 'node-minimum',
    summary: 'Express 5 requires Node.js 18 or later',
    reported: ['decision'],
    applies: (context) => {
      const declared = nodeRange(context);
      if (!declared) return false;
      return satisfies('16.20.2', declared.range)
        ? `\`${declared.file}\` declares \`engines.node\` "${declared.range}", which allows Node older than 18; Express 5 requires Node 18 or later.`
        : false;
    },
  },
  {
    id: 'runtime-defaults',
    summary:
      '`req.host` keeps the port; `res.status()` throws on a code outside 100-999 or not an integer; `res.clearCookie()` ignores `maxAge` and `expires`; `res.vary()` throws without a field; `.js` is served as `text/javascript`',
    reported: ['decision'],
  },
];
