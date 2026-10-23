import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const out = join(root, process.env.SLICC_UNIT_COVERAGE_DIR ?? 'coverage/unit');

function tests() {
  const dir = join(root, 'test/unit');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.test.mjs'))
    .map((name) => join(dir, name));
}

function main() {
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const lcov = join(out, 'lcov.info');
  const files = tests();
  if (files.length === 0) {
    writeFileSync(lcov, '');
    console.log('no unit tests in test/unit');
    return 0;
  }
  const env = { ...process.env };
  delete env.SLICC_UNIT_TESTS;
  const run = spawnSync(
    process.execPath,
    [
      '--test',
      '--experimental-test-coverage',
      '--test-coverage-include=host/**',
      '--test-reporter=spec',
      '--test-reporter-destination=stdout',
      '--test-reporter=lcov',
      `--test-reporter-destination=${lcov}`,
      ...files,
    ],
    { cwd: root, stdio: 'inherit', env }
  );
  if (existsSync(lcov)) {
    writeFileSync(lcov, readFileSync(lcov, 'utf8').replaceAll(`SF:${root}/`, 'SF:'));
  }
  return run.status ?? 1;
}

process.exit(main());
