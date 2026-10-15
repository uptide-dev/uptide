namespace Legacy { // @uptide module-keyword at:Legacy path:TS1540 message:"A 'namespace' declaration should not be declared using the 'module' keyword. Please use the 'namespace' keyword instead."
  export const x = 1;
}
export namespace Exported.Nested { // @uptide module-keyword at:Exported path:TS1540 message:"A 'namespace' declaration should not be declared using the 'module' keyword. Please use the 'namespace' keyword instead."
  export const y = 2;
}
declare module 'ambient-package' { // @uptide module-keyword keep at:'ambient-package' path:TS1540 message:"A 'namespace' declaration should not be declared using the 'module' keyword. Please use the 'namespace' keyword instead."
  export const z: number;
}
export namespace Already {
  export const module = Legacy.x;
}
