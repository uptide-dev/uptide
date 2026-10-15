import assert from 'node:assert';
import data from './data.json' assert { type: 'json' }; // @uptide import-assertions at:assert path:TS2880 message:"Import assertions have been replaced by import attributes. Use 'with' instead of 'assert'."
export const lazy = import('./data.json', { assert: { type: 'json' } }); // @uptide import-assertions at:assert path:TS2880 message:"Import assertions have been replaced by import attributes. Use 'with' instead of 'assert'."
assert(data); // @uptide import-assertions keep at:assert path:TS2880 message:"Import assertions have been replaced by import attributes. Use 'with' instead of 'assert'."
