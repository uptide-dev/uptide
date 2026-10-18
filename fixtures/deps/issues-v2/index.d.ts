/** v2: `errors` is gone (use `issues`), and so is `legacy`. */
export interface Issue {
  message: string;
}
export interface Failure {
  issues: Issue[];
}
export declare function parse(
  input: unknown,
): { success: false; error: Failure } | { success: true; data: string };
