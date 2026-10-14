import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Finding } from '../../domain/report.js';
import { packDecisions } from '../decisions.js';
import { runFixtures } from '../tooling/fixtures.js';
import type { PackContext } from '../types.js';
import {
  domImportSites,
  formMethodSites,
  futureOptionSites,
  moveDomImport,
  moveDomServerImport,
  removeFutureOption,
  uppercaseFormMethod,
} from './detect.js';
import { reactRouterPack } from './index.js';

it('react-router: every fixture rewrites and detects exactly its marked sites', () => {
  const result = runFixtures(reactRouterPack, fileURLToPath(new URL('.', import.meta.url)));
  expect(result.cases.length).toBeGreaterThan(0);
  expect(result.unknown).toEqual([]);
  expect(result.rewriteFailures).toEqual([]);
  expect(result.falsePositives).toEqual([]);
  expect(result.falseNegatives).toEqual([]);
});

const site = (line: number, column: number) => ({ usage: { line, column } }) as Finding;
const context = (inventory: { file: string; text: string }[]): PackContext => ({
  from: '6.30.1',
  to: '7.18.4',
  includeDeprecated: true,
  inventory,
});
const decisions = (inventory: { file: string; text: string }[]) =>
  packDecisions(reactRouterPack, context(inventory), []).join('\n');

describe('react-router-dom imports', () => {
  const code = "import { Link } from 'react-router-dom';\n";
  const [at] = domImportSites(code);

  it('moves the specifier when nothing mocks react-router-dom by name', () => {
    expect(at).toMatchObject({ line: 1, column: 22 });
    const out = moveDomImport(code, site(at?.line ?? 0, at?.column ?? 0), context([]));
    expect(out).toMatchObject({ applied: true, text: "import { Link } from 'react-router';\n" });
  });

  it.each([
    ['a vi.mock elsewhere', 'src/a.test.tsx', "vi.mock('react-router-dom', async () => ({}));"],
    [
      'a jest.requireActual',
      'src/b.test.tsx',
      "jest.mock('x', () => jest.requireActual('react-router-dom'));",
    ],
    [
      'vi.importActual with a type',
      'src/c.test.ts',
      'await vi.importActual<object>("react-router-dom");',
    ],
    ['a __mocks__ module', '__mocks__/react-router-dom.ts', 'export const useNavigate = () => {};'],
  ])('declines when %s would stop standing in for the moved import', (_, file, text) => {
    const out = moveDomImport(code, site(1, 22), context([{ file, text }]));
    expect(out.applied).toBe(false);
    expect(out.reason).toContain(file);
  });

  it('declines in a file that mocks react-router-dom itself', () => {
    const own = `${code}vi.mock('react-router-dom');\n`;
    expect(moveDomImport(own, site(1, 22), context([])).applied).toBe(false);
  });
});

describe('behavior notes are scoped by the router setup', () => {
  const main = (future: string) => ({
    file: 'src/main.tsx',
    text: `import { createBrowserRouter, RouterProvider } from 'react-router-dom';\nconst router = createBrowserRouter([{ path: 'dashboard/*', action: async () => null }], { future: { ${future} } });\nexport const App = () => <RouterProvider router={router} />;\n`,
  });

  it('names the files and lines where a default flag changes behavior', () => {
    const text = decisions([main('v7_fetcherPersist: true')]);
    expect(text).toContain('multi-segment splat routes (`src/main.tsx:2`)');
    expect(text).toContain('routers (`src/main.tsx:2`, `src/main.tsx:3`)');
    expect(text).toContain('route actions (`src/main.tsx:2`)');
  });

  it('omits a note whose flag the repository already enabled', () => {
    const text = decisions([main('v7_relativeSplatPath: true, v7_startTransition: true')]);
    expect(text).not.toContain('v7_relativeSplatPath');
    expect(text).not.toContain('v7_startTransition');
    expect(text).toContain('v7_skipActionErrorRevalidation');
  });

  it('omits flag notes without a router, and package notes without the package', () => {
    const text = decisions([
      {
        file: 'package.json',
        text: '{"dependencies":{"react":"^18.3.1","react-router":"6.30.1"}}',
      },
    ]);
    expect(text).not.toMatch(/v7_|react-router-dom|@remix-run\/router|requires React 18/);
    expect(text).toContain('v6 to v7 upgrade guide');
  });

  it('reports platform floors and the packages v7 folds in', () => {
    const text = decisions([
      {
        file: 'package.json',
        text: '{"dependencies":{"react":"^17.0.2","react-router-dom":"6.30.1","@remix-run/router":"1.23.0"},"engines":{"node":">=18"}}',
      },
      { file: '.nvmrc', text: '18.20.4\n' },
    ]);
    expect(text).toContain('`package.json` declares react ^17.0.2');
    expect(text).toContain('`.nvmrc` pins Node 18.20.4');
    expect(text).toContain('`package.json` declares react-router-dom');
    expect(text).toContain('`package.json` declares it');
  });
});

describe('rewrites kept assisted until ground truth exercises them', () => {
  // Not wired into the pack: no public upgrade in the ground truth has such a site yet
  // (RESEARCH.md). The agent gets the guide; these stay correct for when one does.
  it.each(['dom-server-entry', 'form-method-case', 'future-option'])('%s has no rewrite', (id) => {
    expect(reactRouterPack.rules.find((r) => r.id === id)?.rewrite).toBeUndefined();
  });

  it('moves react-router-dom/server to react-router', () => {
    const code = "import { StaticRouter } from 'react-router-dom/server';\n";
    expect(moveDomServerImport(code, site(1, 30)).text).toBe(
      "import { StaticRouter } from 'react-router';\n",
    );
  });

  it('removes the v6 future option, and the options argument it leaves empty', () => {
    const code =
      "import { createBrowserRouter } from 'react-router-dom';\nexport const r = createBrowserRouter([], { future: { v7_relativeSplatPath: true } });\n";
    const [at] = futureOptionSites(code);
    expect(removeFutureOption(code, site(at?.line ?? 0, at?.column ?? 0)).text).toContain(
      'createBrowserRouter([]);',
    );
  });

  it('uppercases the method compared with formMethod', () => {
    const code =
      "import { useNavigation } from 'react-router-dom';\nexport const f = (n: ReturnType<typeof useNavigation>) => n.formMethod === 'post';\n";
    const [at] = formMethodSites(code);
    expect(uppercaseFormMethod(code, site(at?.line ?? 0, at?.column ?? 0)).text).toContain(
      "n.formMethod === 'POST'",
    );
  });
});
