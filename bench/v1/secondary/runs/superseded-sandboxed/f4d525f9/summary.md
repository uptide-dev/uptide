I upgraded express from 4 to 5.3.0 and committed it on `bench-base` as `c1349d0`. Type-check and lint come back clean, and all 140 tests pass, including one new test.

**What changed**
- **Versions:** `express` is now `^5.3.0` (5.3.0 installed) and `@types/express` is `^5.0.6`. `package-lock.json` was regenerated.
- **Query parsing (`src/app.ts`):** Express 5 parses query strings more simply than Express 4. Under the new default, `?ids[]=1&ids[]=2` ends up under a key literally named `ids[]`, so `/api/mandates` would ignore the filter and return the full list. I added `app.set("query parser", "extended")` to keep the old parsing. The new test in `test/api.test.ts` checks this case, and I confirmed it fails without the setting.
- **`CHANGELOG.md`:** added an entry under Unreleased.

**Things I checked that needed no changes**
- **Route paths:** all routes are plain strings with `:param` placeholders. None use wildcards, optional params or regex, so Express 5's new path-matching rules don't affect them.
- **Async handlers:** Express 5 now sends rejected promises to the error handler. The admin handlers already catch their own errors, so their responses are the same.
- **Error and 404 handlers:** they have the same signatures and responses. Invalid or oversized JSON bodies still reach the error handler and get a 500, as before.
- **Other request data:** no code reads `req.body`, which Express 5 now leaves `undefined` when there's no body. No code assigns to `req.query` or uses removed APIs.

**For review**
1. **Whether to keep the old query parser.** The alternative is Express 5's simpler default, which doesn't build nested objects. Our own client (`src/client/index.ts`) only sends flat keys like `ids=1,2,3`, so it works either way. Keeping the old parser protects other callers who use the bracket form. If you drop the setting, those callers would silently get unfiltered lists.
2. **The lockfile diff.** It's large (about 850 lines) because Express 5 replaces many of its dependencies, so a quick look is worthwhile.
3. **`npm audit`.** The install reported open audit issues. I haven't checked whether they predate this change or come from it, and I didn't run `npm audit fix`.
