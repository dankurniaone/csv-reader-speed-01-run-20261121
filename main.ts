// The program the harness runs: node /bot/main.ts (node 22). It reads every
// case from /input/cases.json, answers each one alone with run() from
// solve.js, and writes /output/answers.json: one answer per case, in the
// cases' order. Outside a container MAKEFUN_INPUT_DIR and
// MAKEFUN_OUTPUT_DIR stand in for /input and /output.
//
// V8's incremental marking is switched off before solve.js is imported so
// all of its work runs under it (the house baseline runs the same way, and
// an entry may tune V8's flags too). The output directory itself is never
// removed — only answers.json inside it is written — because on the grader
// /output is a volume mount point and removing it fails.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setFlagsFromString } from 'node:v8';

setFlagsFromString('--no-incremental-marking');

/** solve.js, imported by its URL (a .js module carries no types) and typed by its contract. */
const { run } = (await import(new URL('./solve.js', import.meta.url).href)) as {
  run: (input: unknown) => unknown;
};

const inDir = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const wanted = JSON.parse(readFileSync(join(inDir, 'cases.json'), 'utf8')) as {
  id: string;
  input: unknown;
}[];

const found: unknown[] = [];
for (const one of wanted) found.push(run(one.input));

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'answers.json'), JSON.stringify(found));
