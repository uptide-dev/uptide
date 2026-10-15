{
  // An older library build: every option TypeScript 6.0 deprecates.
  "compilerOptions": {
    "target": "es5", // @uptide target-es5
    "lib": ["dom", "es2015"],
    "module": "amd", // @uptide module-format-removed
    "moduleResolution": "node", // @uptide module-resolution-node10
    "baseUrl": "./src", // @uptide base-url
    "paths": { "@app/*": ["app/*"] },
    "outFile": "dist/app.js", // @uptide out-file
    "esModuleInterop": false, // @uptide interop-false
    "allowSyntheticDefaultImports": true, // @uptide interop-false keep
    "alwaysStrict": false, // @uptide always-strict-false
    "strict": true,
  },
  "include": ["src"],
}
