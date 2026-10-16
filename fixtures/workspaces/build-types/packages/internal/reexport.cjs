const fs = require('node:fs');
// Stand-in for a declaration bundler that rolls the re-export into its output.
fs.mkdirSync('dist', { recursive: true });
fs.copyFileSync('../../node_modules/moved/index.d.ts', 'dist/index.d.ts');
