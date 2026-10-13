// `uptide.run/v1`, the report one run of the Uptide Action sends to the Uptide app and writes
// to the job summary. Importable on its own as `uptide/report`, with no engine code: the
// builders from engine output (`build.ts`) stay inside the engine.
export { assertSafeReport, reportProblems } from './safe.js';
export {
  type Analysis,
  type BreakingChange,
  type BreakingSite,
  RUN_REPORT_SCHEMA,
  RUN_REPORT_SCHEMA_ID,
  RUN_REPORT_SCHEMA_URL,
  type RunMode,
  type RunReport,
  type Upgrade,
  type UpgradeKind,
  type UpgradeStatus,
  type Verification,
} from './schema.js';
export { renderSummary } from './summary.js';
