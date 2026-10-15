{
  "extends": "./tsconfig.base.json",
  "compilerOptions": {
    "target": "es2019", // @uptide target-es5 keep
    "downlevelIteration": true, // @uptide downlevel-iteration
    "module": "esnext", // @uptide module-format-removed keep
    "moduleResolution": "bundler", // @uptide module-resolution-node10 keep
    "outDir": "dist", // @uptide out-file keep
    "paths": { "@app/*": ["./src/app/*"] }, // @uptide base-url keep
    "alwaysStrict": true, // @uptide always-strict-false keep
    "esModuleInterop": true, // @uptide module-resolution-classic keep
    "declaration": true // @uptide downlevel-iteration keep
  }
}
