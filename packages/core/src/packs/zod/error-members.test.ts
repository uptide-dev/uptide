import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { Finding } from '../../domain/report.js';
import type { Usage } from '../../domain/usage.js';
import { ruleFor } from '../contract.js';
import { errorMemberFindings, errorMemberSites, rewriteErrorMembers } from './error-members.js';
import { zodPack } from './index.js';

const context = { from: '3.25.76', to: '4.6.5', includeDeprecated: false };
/** The finding detection reports in `text`, as `check` would: the site's line, column and snippet. */
function finding(text: string, file = 'form.tsx', index = 0): Finding {
  const site = errorMemberSites(text, file, new Set(['schema']))[index];
  if (!site) throw new Error('no site');
  const path = site.name as string;
  return {
    change: {
      package: 'zod',
      ...context,
      path,
      kind: 'removed',
      severity: 'breaking',
      source: 'pack',
      confidence: 1,
    },
    usage: {
      file,
      line: site.line,
      column: site.column,
      endLine: site.line,
      endColumn: site.column,
      symbolPath: path,
      access: 'read',
      snippet: site.snippet,
      via: 'direct',
    },
    severity: 'breaking',
    confidence: 1,
    fixability: 'mechanical',
    reason: '',
    rule: 'error-members',
  };
}
const form = (imports: string, read: string, body = 'schema.parse(values);') =>
  `${imports}\nimport { schema } from '@/lib/zod';\nexport const validate = (values: unknown) => {\n  try {\n    ${body}\n  } catch (error: any) {\n    return ${read};\n  }\n};\n`;

describe('error-members detection', () => {
  it('finds formErrors and errors read off a catch binding of a zod parse', () => {
    for (const read of [
      'error.formErrors.fieldErrors',
      'error.errors',
      '(error as any).formErrors',
      'error?.formErrors',
    ])
      expect(errorMemberSites(form("import { z } from 'zod';", read), 'a.ts')).toHaveLength(1);
    const alias = `import { z } from 'zod';\nconst s = z.object({});\ntry { await s.parseAsync(v); } catch (e) { const err = e as any; log(err.formErrors); }`;
    expect(errorMemberSites(alias, 'a.ts')).toMatchObject([
      { line: 3, name: 'ZodError#formErrors' },
    ]);
  });
  it('leaves typed errors, other try blocks, zod/v3 and narrowed bindings alone', () => {
    for (const text of [
      // No zod parse: what is caught is not a zod error.
      form("import { z } from 'zod';", 'error.errors', 'JSON.parse(values as string);'),
      form("import { z } from 'zod';", 'error.formErrors', 'await save(values);'),
      // zod/v3 keeps the members.
      `import { z } from 'zod/v3';\ntry { z.string().parse(1) } catch (e: any) { e.formErrors }`,
      // Narrowed or typed: the compiler reports it.
      `import { z, ZodError } from 'zod';\ntry { z.string().parse(1) } catch (e) { if (e instanceof ZodError) e.formErrors }`,
      `import { z } from 'zod';\nconst r = z.string().safeParse(1); if (!r.success) r.error.formErrors;`,
      // A binding with a type of its own is not the caught value.
      `import { z } from 'zod';\ntry { z.string().parse(1) } catch (e) { const err: Problem = e as any; err.errors }`,
      // A shadowed z is not zod.
      `import { z } from 'zod';\nfunction f(z: any) { try { z.parse(1) } catch (e: any) { e.formErrors } }`,
    ])
      expect(errorMemberSites(text, 'a.ts')).toEqual([]);
    // Without zod or a local import, no site.
    expect(
      errorMemberSites(
        "import { schema } from 'some-package';\ntry { schema.parse(1) } catch (e: any) { e.formErrors }",
        'a.ts',
      ),
    ).toEqual([]);
  });
  it('parses .tsx as JSX', () => {
    const text = `${form("import { z } from 'zod';", 'error.formErrors.fieldErrors')}export const View = () => <div className="x">{String(1)}</div>;\n`;
    expect(errorMemberSites(text, 'form.tsx')).toHaveLength(1);
  });
});

describe('error-members rewrite', () => {
  const rewrite = (text: string, file = 'form.ts') =>
    zodPack.transform(text, finding(text, file), context);
  it.each([
    ["import { z } from 'zod';", 'z.flattenError(error).fieldErrors'],
    ["import { z as v } from 'zod';", 'v.flattenError(error).fieldErrors'],
    ["import * as zod from 'zod';", 'zod.flattenError(error).fieldErrors'],
    ["import zod from 'zod';", 'zod.flattenError(error).fieldErrors'],
  ])('uses the zod binding the file has: %s', (imports, expected) => {
    const result = rewrite(form(imports, 'error.formErrors.fieldErrors'));
    expect(result).toMatchObject({ applied: true, rule: 'error-members' });
    expect(result.text).toContain(`return ${expected};`);
    expect(result.text.match(/from 'zod'/g)).toHaveLength(1);
  });
  it('keeps formErrors.formErrors, and the cast', () => {
    const result = rewrite(
      form("import { z } from 'zod';", '(error as any).formErrors.formErrors'),
    );
    expect(result.text).toContain('return z.flattenError(error as any).formErrors;');
  });
  it('adds z to an existing value import from zod on its own line', () => {
    const result = rewrite(form("import { ZodError } from 'zod';", 'error.formErrors.fieldErrors'));
    expect(result.text.split('\n')[0]).toBe("import { z, ZodError } from 'zod';");
  });
  it('imports z after the last import when the file has no zod import', () => {
    const text = form("import { useFormik } from 'formik';", 'error.formErrors.fieldErrors');
    expect(rewrite(text).text).toContain(
      "import { schema } from '@/lib/zod';\nimport { z } from 'zod';\n",
    );
  });
  it('migrates two sites of one file bottom-up when the first adds the import', () => {
    const one = '  try { schema.parse(a) } catch (e: any) { return e.formErrors.fieldErrors; }';
    let text = `import { schema } from './schema';\n\nfunction a() {\n${one}\n}\nfunction b() {\n${one}\n}\n`;
    const sites = [finding(text, 'a.ts', 0), finding(text, 'a.ts', 1)];
    for (const site of sites.reverse()) {
      const result = zodPack.transform(text, site, context);
      expect(result.applied).toBe(true);
      text = result.text;
    }
    expect(text.match(/z\.flattenError\(e\)\.fieldErrors/g)).toHaveLength(2);
    expect(text.match(/import \{ z \} from 'zod';/g)).toHaveLength(1);
  });
  it('leaves every other shape to the agent', () => {
    for (const read of [
      'error.formErrors',
      'error?.formErrors?.fieldErrors',
      'error.formErrors.fieldErrors.name',
    ]) {
      const text = form("import { z } from 'zod';", read);
      const site = finding(text);
      const result = zodPack.transform(text, site, context);
      if (read.endsWith('.name')) expect(result.applied).toBe(true);
      else expect(result.applied).toBe(false);
    }
    const write = form("import { z } from 'zod';", '(error.formErrors.fieldErrors = {})');
    expect(zodPack.transform(write, finding(write), context).applied).toBe(false);
    const shadowed = `import { schema } from './s';\nconst z = 1;\ntry { schema.parse(1) } catch (e: any) { e.formErrors.fieldErrors }`;
    expect(zodPack.transform(shadowed, finding(shadowed, 'a.ts'), context)).toMatchObject({
      applied: false,
      reason: expect.stringContaining('`z` names something else'),
    });
  });
  it('renames errors to issues off a caught zod error, never off another try', () => {
    for (const read of ['error.errors[0].message', '(error as any).errors?.length']) {
      const text = form("import { z } from 'zod';", read);
      const result = zodPack.transform(text, finding(text), context);
      expect(result).toMatchObject({ applied: true, rule: 'error-members' });
      expect(result.text).toBe(text.replace('.errors', '.issues'));
    }
    const text = form("import { z } from 'zod';", 'error.errors');
    const site = finding(text);
    const other = text.replace('schema.parse(values);', 'JSON.parse(values as string);');
    expect(zodPack.transform(other, site, context).applied).toBe(false);
    const write = form("import { z } from 'zod';", '(error.errors = [])');
    expect(zodPack.transform(write, finding(write), context).applied).toBe(false);
  });
  it('never edits a read detection would not report, and is idempotent', () => {
    const text = form("import { z } from 'zod';", 'error.formErrors.fieldErrors');
    const site = finding(text);
    const migrated = zodPack.transform(text, site, context).text;
    expect(zodPack.transform(migrated, site, context).applied).toBe(false);
    const other = text.replace('schema.parse(values);', 'await save(values);');
    expect(zodPack.transform(other, site, context).applied).toBe(false);
  });
});

describe('error-issues', () => {
  /** What the type diff reports at a typed read: the checker resolved the member's declaration. */
  const typed = (text: string, at: string, path = 'ZodError#errors'): Finding => {
    const line = text.split('\n').findIndex((l) => l.includes(at)) + 1;
    const column = (text.split('\n')[line - 1] as string).indexOf(at) + 1;
    return {
      change: {
        package: 'zod',
        ...context,
        path,
        kind: 'removed',
        severity: 'breaking',
        source: 'types',
        confidence: 1,
      },
      usage: {
        file: 'a.ts',
        line,
        column,
        endLine: line,
        endColumn: column,
        symbolPath: path,
        access: 'read',
        snippet: '',
        via: 'direct',
      },
      severity: 'breaking',
      confidence: 1,
      fixability: 'manual',
      reason: 'removed',
    };
  };
  it('claims only the removed ZodError#errors', () => {
    const text = 'r.error.errors';
    expect(ruleFor(zodPack.rules, typed(text, 'errors'))?.id).toBe('error-issues');
    for (const path of ['Form#errors', 'ZodError#formErrors', 'ZodIssue#errors'])
      expect(ruleFor(zodPack.rules, typed(text, 'errors', path))?.id).not.toBe('error-issues');
  });
  it('renames the typed read and keeps a destructured local name', () => {
    const text = 'const m = r.error.errors[0]?.message;\nconst { errors } = r.error;\n';
    const read = zodPack.transform(text, typed(text, 'errors['), context);
    expect(read).toMatchObject({ applied: true, rule: 'error-issues' });
    expect(read.text).toBe(text.replace('errors[0]', 'issues[0]'));
    const bound = zodPack.transform(text, typed(text, 'errors }'), context);
    expect(bound.text).toBe(text.replace('{ errors }', '{ issues: errors }'));
  });
  it('declines writes, rest elements and a site with no errors read at it', () => {
    for (const [text, at] of [
      ['e.errors = [];', 'errors'],
      ['delete e.errors;', 'errors'],
      ['const { ...errors } = e;', '...errors'],
    ] as const)
      expect(zodPack.transform(text, typed(text, at), context).applied).toBe(false);
  });
});

describe('error-members in check', () => {
  const root = mkdtempSync(join(tmpdir(), 'uptide-zod-error-members-'));
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  const write = (file: string, text: string) => {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text);
  };
  const validate = (imports: string, schema: string, read = 'error.formErrors.fieldErrors') =>
    `${imports}\nexport const validate = (values: unknown) => {\n  try {\n    ${schema}.parse(values);\n  } catch (error: any) {\n    return ${read};\n  }\n};\n`;
  // The layout of boxyhq/saas-starter-kit: schemas behind `@/lib/zod`, re-exported wholesale.
  write(
    'tsconfig.json',
    JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@/lib/*': ['lib/*'] } } }),
  );
  write(
    'lib/zod/index.ts',
    "import z from 'zod';\nexport * from './schema';\nexport const check = (s: z.ZodType, d: unknown) => s.parse(d);\n",
  );
  write(
    'lib/zod/schema.ts',
    "import { z } from 'zod';\nexport const updateTeamSchema = z.object({});\nexport const createApiKeySchema = z.object({});\nexport const updateAccountSchema = z.object({});\n",
  );
  write('lib/common.ts', 'export const parser = { parse: (v: unknown) => v };\n');
  write(
    'components/team/TeamSettings.tsx',
    validate(
      "import { z } from 'zod';\nimport { updateTeamSchema } from '@/lib/zod';",
      'updateTeamSchema',
    ),
  );
  write(
    'components/apiKey/NewAPIKey.tsx',
    validate(
      "import { z } from 'zod';\nimport { createApiKeySchema } from '@/lib/zod';",
      'createApiKeySchema',
    ),
  );
  write(
    'components/account/UpdateName.tsx',
    validate("import { updateAccountSchema } from '@/lib/zod';", 'updateAccountSchema'),
  );
  write(
    'components/account/UpdateEmail.tsx',
    validate(
      "import { updateAccountSchema } from '@/lib/zod';",
      'updateAccountSchema',
      'error.errors',
    ),
  );
  // Not zod: `parse` of the repository's own helper.
  write('components/Other.tsx', validate("import { parser } from '@/lib/common';", 'parser'));
  const usages = [
    'lib/zod/index.ts',
    'lib/zod/schema.ts',
    'components/team/TeamSettings.tsx',
    'components/apiKey/NewAPIKey.tsx',
  ].map((file) => ({ file }) as Usage);
  const run = () =>
    errorMemberFindings({
      root,
      workspace: '.',
      ...context,
      usages,
      read: (file) => {
        try {
          return readFileSync(join(root, file), 'utf8');
        } catch {
          return undefined;
        }
      },
      rewrite: rewriteErrorMembers,
    });
  it('reports the forms that import a schema from the repository, mechanical where the rule rewrites', () => {
    expect(
      run().map((f) => `${f.usage.file}:${f.usage.line} ${f.change.path} ${f.fixability}`),
    ).toEqual([
      'components/account/UpdateEmail.tsx:6 ZodError#errors mechanical',
      'components/account/UpdateName.tsx:6 ZodError#formErrors mechanical',
      'components/apiKey/NewAPIKey.tsx:7 ZodError#formErrors mechanical',
      'components/team/TeamSettings.tsx:7 ZodError#formErrors mechanical',
    ]);
    expect(run().every((f) => f.rule === 'error-members' && f.severity === 'breaking')).toBe(true);
  });
  it('the rewritten form validates with z.flattenError, importing z where it was missing', () => {
    const file = 'components/account/UpdateName.tsx';
    const site = run().find((f) => f.usage.file === file) as Finding;
    const result = zodPack.transform(readFileSync(join(root, file), 'utf8'), site, context);
    expect(result.text).toBe(
      validate(
        "import { updateAccountSchema } from '@/lib/zod';\nimport { z } from 'zod';",
        'updateAccountSchema',
        'z.flattenError(error).fieldErrors',
      ),
    );
  });
});
