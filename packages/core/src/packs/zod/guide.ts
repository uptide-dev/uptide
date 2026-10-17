// Maintained excerpts/paraphrases of https://zod.dev/v4/changelog, checked 2026-10-01
// (errorMembers, with https://zod.dev/error-formatting: 2026-10-14).
// Runtime never downloads migration instructions.
export const zodGuide = {
  record:
    'Zod 4 removes the single-argument z.record overload. Use z.record(z.string(), valueSchema) to preserve string keys, retaining the existing Zod import binding. Leave explicit key/value schemas unchanged.',
  errors:
    'Zod 4 uses error for customization. required_error and invalid_type_error were removed. Distinguish missing input using issue.input === undefined; returning undefined delegates to the default error map. Do not combine the old keys with errorMap.',
  formats:
    'String formats moved to top-level factories. email, url and base64 are on z; datetime is on z.iso. uuid becomes z.guid(), not z.uuid(): zod 3 accepted any 8-4-4-4-12 hex id, and z.uuid() in zod 4 also checks the RFC version and variant, so ids such as 11111111-1111-1111-1111-111111111111 stop validating. Use z.uuid() only where every id is a real UUID. Keep validation options and subsequent chain operations. message is deprecated in favor of error.',
  ip: 'The combined string.ip validator was removed. Use z.ipv4() or z.ipv6() when the intended family is known; use z.union([z.ipv4(), z.ipv6()]) when the previous validator accepted both families. These are top-level factories, not z.string() methods. Preserve options and error text.',
  errorMembers:
    'ZodError.formErrors and ZodError.errors were removed in Zod 4 and read undefined. formErrors was identical to flatten(): use z.flattenError(error), which returns the same { formErrors, fieldErrors } object (flatten() is deprecated). errors was an alias of issues: use error.issues. Keep the returned shape and the control flow; do not cast to hide the change.',
  removedExports:
    "Zod 4's root no longer exports the names zod 3 kept for its internals: SafeParseReturnType, SafeParseSuccess and SafeParseError (use ZodSafeParseResult, which takes only the output type), ZodTypeDef and the Zod*Def interfaces (gone), ZodEffects (a refinement or transform is now the schema itself, a ZodPipe for transform), ZodNativeEnum (use ZodEnum), and the parse and issue helpers. They are still exported from 'zod/v3', which keeps zod 3's runtime and types, not the schemas you build with 'zod'. Replace the name with its zod 4 equivalent; do not import it from 'zod/v3' while the schemas come from 'zod'.",
  generics:
    'ZodType now takes Output and Input, defaulting to unknown. The definition type parameter is gone. Remove reliance on ZodTypeDef without weakening the input/output contract. SafeParse success contains data; failure contains error. Narrow on success before accessing either. Preserve validation and type safety; do not cast to any to hide diagnostics.',
};
