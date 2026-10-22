#!/usr/bin/env node
// Check that the Codex `--output-schema <(printf ...)` process substitution
// survives the `bash -c "cd ... && ..."` wrapping, including `$`, backticks
// and quotes in the schema (issue #57). A stand-in `codex` on PATH prints the
// path and content of the schema file it receives.
// Run with: node experiments/issue-57-structured-output.mjs
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agent } from '../js/src/index.mjs';

const bin = mkdtempSync(join(tmpdir(), 'fake-codex-'));
writeFileSync(
  join(bin, 'codex'),
  `#!/bin/bash
cat >/dev/null
while [ $# -gt 0 ]; do
  if [ "$1" = "--output-schema" ]; then echo "schema-path=$2"; echo "schema=$(cat "$2")"; fi
  shift
done
`
);
chmodSync(join(bin, 'codex'), 0o755);
process.env.PATH = `${bin}:${process.env.PATH}`;

const jsonSchema = {
  type: 'object',
  properties: { a: { type: 'string', description: 'say "hi" $HOME `x`' } },
};
const controller = agent({
  tool: 'codex',
  workingDirectory: tmpdir(),
  prompt: "it's",
  jsonSchema,
});
await controller.start({ attached: false });
const result = await controller.stop();
console.log(result.output.plain.trim());
const received = result.output.plain.match(/^schema=(.*)$/m)?.[1];
console.log(
  received === JSON.stringify(jsonSchema) ? 'OK: schema intact' : 'MISMATCH'
);
