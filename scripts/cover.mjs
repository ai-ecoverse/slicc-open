import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const out = join(root, process.env.SLICC_UNIT_COVERAGE_DIR ?? 'coverage/unit');
const traces = join(out, 'traces');
const bin = join(root, 'bin');

const skip = [
  /^\s*$/,
  /^#!/,
  /^\s*(\}|fi|done|esac|;;|else|then|do)\s*$/,
  /^\s*[\w-]+\(\)\s*\{\s*$/,
  /^\s*[^()]+\)\s*(;;)?\s*$/,
  /^\s*case .* in$/,
  /='$/,
];

function tests() {
  const dir = join(root, 'test/unit');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.test.mjs'))
    .map((name) => join(dir, name));
}

function executable(source) {
  const lines = [];
  source.split('\n').forEach((text, index) => {
    if (!skip.some((pattern) => pattern.test(text))) lines.push(index + 1);
  });
  return lines;
}

function hits() {
  const counts = new Map();
  for (const file of readdirSync(traces)) {
    for (const line of readFileSync(join(traces, file), 'utf8').split('\n')) {
      const match = /^\++([\w.-]+):(\d+):/.exec(line);
      if (!match) continue;
      const own = counts.get(match[1]) ?? new Map();
      own.set(Number(match[2]), (own.get(Number(match[2])) ?? 0) + 1);
      counts.set(match[1], own);
    }
  }
  return counts;
}

function scripts() {
  const counts = hits();
  let text = '';
  for (const name of existsSync(bin) ? readdirSync(bin).sort() : []) {
    const lines = executable(readFileSync(join(bin, name), 'utf8'));
    const own = counts.get(name) ?? new Map();
    const missed = lines.filter((line) => !own.get(line));
    text += `SF:bin/${name}\n`;
    for (const line of lines) text += `DA:${line},${own.get(line) ?? 0}\n`;
    text += `LF:${lines.length}\nLH:${lines.length - missed.length}\nend_of_record\n`;
    console.log(
      `bin/${name}: ${lines.length - missed.length}/${lines.length}${missed.length ? ` missed ${missed.join(',')}` : ''}`
    );
  }
  return text;
}

function main() {
  rmSync(out, { recursive: true, force: true });
  mkdirSync(traces, { recursive: true });
  const lcov = join(out, 'lcov.info');
  const files = tests();
  if (files.length === 0) {
    writeFileSync(lcov, '');
    console.log('no unit tests in test/unit');
    return 0;
  }
  const env = { ...process.env, SLICC_OPEN_TRACE: traces };
  delete env.SLICC_UNIT_TESTS;
  const js = join(out, 'js.info');
  const run = spawnSync(
    process.execPath,
    [
      '--test',
      '--test-concurrency=1',
      '--experimental-test-coverage',
      '--test-coverage-include=host/**',
      '--test-reporter=spec',
      '--test-reporter-destination=stdout',
      '--test-reporter=lcov',
      `--test-reporter-destination=${js}`,
      ...files,
    ],
    { cwd: root, stdio: 'inherit', env }
  );
  const own = existsSync(js) ? readFileSync(js, 'utf8').replaceAll(`SF:${root}/`, 'SF:') : '';
  writeFileSync(lcov, scripts() + own);
  return run.status ?? 1;
}

process.exit(main());
