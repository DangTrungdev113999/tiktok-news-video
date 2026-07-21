// CI check: a path pasted with Windows Explorer's "Copy as path" — which wraps
// it in double quotes — must survive init's workspace question.
//
// Lives in a file rather than inline in the workflow on purpose. The inline
// version had to escape a regex through PowerShell's here-string, YAML, and
// Node, and it false-failed on its first real run. A file has exactly one
// layer of quoting.
//
// It also asserts BEHAVIOUR, not source text: it calls expandHome and then
// actually creates the directory, because "the quote is gone from the string"
// and "NTFS accepts this path" are different claims and only the second one
// matters.

import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expandHome } from '../../scripts/init.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'expand-home-'));
const target = path.join(tmp, 'ws');

const cases = [
  { label: 'double-quoted (Windows "Copy as path")', input: `"${target}"` },
  { label: "single-quoted", input: `'${target}'` },
  { label: 'plain, with stray whitespace', input: `  ${target}  ` },
];

for (const { label, input } of cases) {
  const got = expandHome(input);
  assert.equal(got, target, `${label}: expandHome returned ${JSON.stringify(got)}`);
  // The real test: does the filesystem accept it? A leftover quote is an
  // illegal NTFS character and mkdir throws — which is the failure this
  // whole check exists to prevent.
  fs.mkdirSync(got, { recursive: true });
  assert.ok(fs.statSync(got).isDirectory(), `${label}: directory was not created`);
  fs.rmSync(got, { recursive: true, force: true });
  console.log(`OK - ${label}`);
}

// `~` must still expand, and must not be mistaken for a quote.
assert.equal(expandHome('~/ws'), path.join(os.homedir(), 'ws'));
console.log('OK - tilde still expands');

fs.rmSync(tmp, { recursive: true, force: true });
console.log('OK - expandHome accepts quoted paths and the filesystem agrees');
