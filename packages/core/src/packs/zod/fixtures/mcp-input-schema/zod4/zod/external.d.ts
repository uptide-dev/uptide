// The parts of zod 4.6.5's classic `v4/classic/schemas.d.ts` and `v4/core/schemas.d.ts` the
// record's trigger reads. `$strip` and `$strict` are the same shape there too: only the alias differs.
export type $strip = { out: {}; in: {} };
export type $strict = { out: {}; in: {} };
export type $loose = { out: Record<string, unknown>; in: Record<string, unknown> };
export type $catchall<T> = { out: { [k: string]: T }; in: { [k: string]: T } };
export interface $ZodTypeInternals {
  output: unknown;
}
export interface ZodType {
  _zod: $ZodTypeInternals;
  /** @deprecated */
  _def: unknown;
  parse(data: unknown): unknown;
  optional(): ZodOptional<this>;
}
export type ZodRawShape = { [k: string]: ZodType };
export interface ZodString extends ZodType {}
export interface ZodNever extends ZodType {}
export interface ZodOptional<T extends ZodType> extends ZodType {
  unwrap(): T;
}
export interface ZodObject<Shape extends ZodRawShape = ZodRawShape, Config = $strip> extends ZodType {
  shape: Shape;
  /** @internal */
  _config?: Config;
  strict(): ZodObject<Shape, $strict>;
  strip(): ZodObject<Shape, $strip>;
  passthrough(): ZodObject<Shape, $loose>;
  catchall<T extends ZodType>(schema: T): ZodObject<Shape, $catchall<T>>;
}
export declare function string(): ZodString;
export declare function never(): ZodNever;
export declare function object<T extends ZodRawShape>(shape: T): ZodObject<T, $strip>;
export declare function strictObject<T extends ZodRawShape>(shape: T): ZodObject<T, $strict>;
