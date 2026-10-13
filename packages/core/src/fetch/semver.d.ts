declare module 'semver' {
  const semver: {
    satisfies(version: string, range: string): boolean;
    maxSatisfying(versions: string[], range: string): string | null;
    minVersion(range: string): { version: string } | null;
    validRange(range: string): string | null;
    valid(version: string): string | null;
    major(version: string): number;
    minor(version: string): number;
    coerce(version: string): { version: string } | null;
    intersects(a: string, b: string): boolean;
  };
  export default semver;
}
