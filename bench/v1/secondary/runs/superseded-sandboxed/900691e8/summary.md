I upgraded Express from 4.22.2 to 5.3.0 and committed it on `bench-base` as `db595e3`. Type-check and lint pass, and all 141 tests pass (139 existing plus 2 new). No source code needed to change.

**What changed**
- `package.json` / lockfile: `express` is now `^5.3.0` and `@types/express` is `^5.0.6`.
- `test/api.test.ts`: two new tests for how query strings are read (a repeated `ids` key, and keys written with brackets).
- `CHANGELOG.md`: a new "Changed" entry describing the upgrade.

**How I checked behavior:** I sent 16 tricky requests to both v4 and v5 and compared the results. They covered repeated query keys, uppercase and trailing-slash paths, admin auth, encoded paths and `%2F` in parameters, bad JSON, a request body over the 64kb limit, and `HEAD /health`.

**What to review**
1. **Query strings are read differently.** Express 5 uses a simpler parser by default, so a key like `merchant[x]=…` or `ids[]=1` is now taken literally instead of becoming a nested value. In practice, such a request now ignores the filter instead of applying it or returning 400. The client and docs only use `ids=1,2,3`, repeated keys like `ids=1&ids=2` still work, and every handler already converts query values with `String()` or `Number()`. I kept the new default because it's the safer choice. If anything outside the client relies on bracket keys, `app.set("query parser", "extended")` restores the old behavior.
2. **Paths with a double slash now return 404.** `/admin//reindex` matched in v4 and returns 404 in v5. Admin auth still runs first, so this is only stricter. Uppercase and trailing-slash paths behave the same as before.
3. **Errors in async handlers now reach the error handler.** In v5, a failing `async` handler goes to the app's 500 handler; in v4 it would have left the request hanging. The admin handlers already catch their own errors, so nothing changes today, but it's worth knowing for future routes.
4. **Bad request bodies give the same results as before.** Malformed JSON and bodies over 64kb still get 500 `internal_error`, as they did in v4. Express attaches 400/413 status codes to these errors but the app's error handler ignores them; that's not new, but it could be fixed separately.
5. **`npm audit` still reports one high-severity issue.** It's in `follow-redirects` and was there before the upgrade, so I left it alone.
