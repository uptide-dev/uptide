const fs = require('node:fs');
if (process.env.npm_config_ignore_scripts !== 'true') process.exit(1);
fs.mkdirSync('dist', { recursive: true });
fs.writeFileSync('dist/index.d.ts', 'export declare const value: number;\n');
