/** v1: a parse failure lists its issues as `issues` and as `errors`. */
export interface Issue {
  message: string;
}
export interface Failure {
  issues: Issue[];
  errors: Issue[];
}
export declare function parse(
  input: unknown,
): { success: false; error: Failure } | { success: true; data: string };
export declare function legacy(): number;
