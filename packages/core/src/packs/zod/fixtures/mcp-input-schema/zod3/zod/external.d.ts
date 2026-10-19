// The parts of zod 3.25.76's `v3/types.d.ts` the record's trigger reads.
export interface ZodTypeDef {}
export declare abstract class ZodType<Output = any, Def extends ZodTypeDef = ZodTypeDef, Input = Output> {
  readonly _type: Output;
  readonly _input: Input;
  readonly _def: Def;
  parse(data: unknown): Output;
  optional(): ZodOptional<this>;
}
export type ZodTypeAny = ZodType<any, any, any>;
export type ZodRawShape = { [k: string]: ZodTypeAny };
export type UnknownKeysParam = 'passthrough' | 'strict' | 'strip';
export declare class ZodString extends ZodType<string> {}
export declare class ZodNever extends ZodType<never> {}
export declare class ZodOptional<T extends ZodTypeAny> extends ZodType<T['_type'] | undefined> {}
export declare class ZodObject<
  T extends ZodRawShape,
  UnknownKeys extends UnknownKeysParam = UnknownKeysParam,
  Catchall extends ZodTypeAny = ZodTypeAny,
> extends ZodType<{ [k in keyof T]: T[k]['_type'] }> {
  readonly shape: T;
  strict(): ZodObject<T, 'strict', Catchall>;
  strip(): ZodObject<T, 'strip', Catchall>;
  passthrough(): ZodObject<T, 'passthrough', Catchall>;
  catchall<Index extends ZodTypeAny>(index: Index): ZodObject<T, UnknownKeys, Index>;
}
export declare const string: () => ZodString;
export declare const never: () => ZodNever;
export declare const object: <T extends ZodRawShape>(shape: T) => ZodObject<T, 'strip', ZodTypeAny>;
export declare const strictObject: <T extends ZodRawShape>(shape: T) => ZodObject<T, 'strict'>;
