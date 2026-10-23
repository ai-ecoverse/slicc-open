import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { run } from '../../host/main.mjs';
import { usage } from '../../host/options.mjs';
import { windowsCommandLine, windowsScript } from '../../host/windows.mjs';

const root = resolve(import.meta.dirname, '../..');
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'slicc-open-host-')));
const hostile = 'https://example.com/a?b=$(touch PWNED)&c=`touch PWNED`;rm -rf x|y\'"%PATH%';

after(() => rmSync(scratch, { recursive: true, force: true }));

function fake(name) {
  return `#!${process.execPath}
const fs = require('node:fs');
const argv = process.argv.slice(2);
const record = { name: ${JSON.stringify(name)}, argv, cwd: process.cwd() };
record.env = {};
for (const key of ['SCOPEN_ARGV', 'SCOPEN_INSTALL_DIR', 'FAKE_A', 'FAKE_KEPT']) record.env[key] = process.env[key];
for (const arg of argv) {
  try {
    if (fs.statSync(arg).isFile()) record.file = fs.readFileSync(arg, 'utf8');
  } catch {}
}
try {
  if (!fs.fstatSync(0).isFIFO() || process.env.FAKE_STDIN) record.stdin = fs.readFileSync(0, 'utf8');
} catch {}
process.stdout.write('out of ${name}\\n');
process.stderr.write(process.env.FAKE_FAIL === ${JSON.stringify(name)} ? 'failed in ${name}\\n' : '');
fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify(record) + '\\n');
if (process.env.FAKE_INSTALLED && argv.includes('-File')) process.stdout.write('scopen ' + process.env.FAKE_INSTALLED + ' installed to x\\n');
if (process.env.FAKE_FAIL === ${JSON.stringify(name)}) process.exit(3);
if (process.env.FAKE_QUIET === ${JSON.stringify(name)}) process.exit(4);
`;
}

function tools(names) {
  const dir = mkdtempSync(join(scratch, 'bin-'));
  for (const name of names) {
    writeFileSync(join(dir, name), fake(name));
    chmodSync(join(dir, name), 0o755);
  }
  return dir;
}

function base() {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (
      !['PATH', 'SCOPEN_INSTALL_DIR', 'SLICC_INSTALL_BASE_URL', 'NODE_OPTIONS'].includes(
        key.toUpperCase()
      )
    ) {
      env[key] = value;
    }
  }
  return env;
}

function workdir() {
  const dir = mkdtempSync(join(scratch, 'cwd-'));
  writeFileSync(join(dir, 'notes.txt'), 'notes\n');
  mkdirSync(join(dir, 'sub'));
  writeFileSync(join(dir, 'sub', 'page.html'), '<p>page</p>\n');
  writeFileSync(join(dir, '-weird'), 'weird\n');
  writeFileSync(join(dir, "it's $(touch PWNED) `x`.txt"), 'hostile\n');
  return dir;
}

const everything = [
  'open',
  'xdg-open',
  'gio',
  'powershell.exe',
  'pwsh.exe',
  'explorer.exe',
  'notepad.exe',
  'myapp',
];

async function scopen({ platform, argv, names = everything, extra = {}, stdin = '', cwd }) {
  const bin = tools(names);
  const log = mkdtempSync(join(scratch, 'log-'));
  const dir = cwd ?? workdir();
  writeFileSync(join(log, 'in'), stdin);
  const fds = [
    openSync(join(log, 'in'), 'r'),
    openSync(join(log, 'out'), 'w'),
    openSync(join(log, 'err'), 'w'),
  ];
  const env = { ...base(), PATH: bin, FAKE_LOG: join(log, 'calls'), ...extra };
  let code;
  try {
    code = await run({ argv, env, platform, cwd: dir, fds });
  } finally {
    for (const fd of fds) closeSync(fd);
  }
  const calls = () =>
    existsSync(join(log, 'calls'))
      ? readFileSync(join(log, 'calls'), 'utf8')
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.parse(line))
      : [];
  return {
    code,
    cwd: dir,
    stdout: readFileSync(join(log, 'out'), 'utf8'),
    stderr: readFileSync(join(log, 'err'), 'utf8'),
    calls: calls(),
    later: async (count) => {
      for (let tries = 0; tries < 100 && calls().length < count; tries++) {
        await new Promise((done) => setTimeout(done, 50));
      }
      return calls();
    },
  };
}

function pwned(dir) {
  return existsSync(join(dir, 'PWNED')) || existsSync(join(root, 'PWNED'));
}

describe('scopen on macOS', () => {
  it('runs open once with every target, files as absolute paths and URLs unchanged', async () => {
    const result = await scopen({
      platform: 'darwin',
      argv: ['https://example.com', 'notes.txt', 'sub/page.html'],
    });
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(
      result.calls.map((call) => [call.name, call.argv]),
      [
        [
          'open',
          [
            'https://example.com',
            join(result.cwd, 'notes.txt'),
            join(result.cwd, 'sub', 'page.html'),
          ],
        ],
      ]
    );
    assert.equal(result.calls[0].cwd, result.cwd);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, '');
  });

  it('passes every other option to open unchanged and in order, with --args last', async () => {
    const result = await scopen({
      platform: 'darwin',
      argv: [
        '-a',
        'Safari',
        '-Wngj',
        '-F',
        '-bcom.apple.Safari',
        '-R',
        '-u',
        'https://u.example',
        '--env=FAKE_A=1',
        '--stdin',
        'in.txt',
        '--stdout',
        'out.txt',
        '--stderr=err.txt',
        '--arch',
        'arm64',
        '-e',
        '-t',
        '--',
        '-weird',
        '--args',
        '-x',
        'y',
      ],
    });
    assert.equal(result.code, 2);
    const ok = await scopen({
      platform: 'darwin',
      argv: [
        '-a',
        'Safari',
        '-Wngj',
        '-F',
        '-bcom.apple.Safari',
        '-R',
        '-u',
        'https://u.example',
        '--env=FAKE_A=1',
        '--stdin',
        'in.txt',
        '--stdout',
        'out.txt',
        '--stderr=err.txt',
        '--arch',
        'arm64',
        '-t',
        'notes.txt',
        '--args',
        '-x',
        'y',
      ],
    });
    assert.equal(ok.code, 0, ok.stderr);
    assert.deepEqual(ok.calls[0].argv, [
      '-a',
      'Safari',
      '-W',
      '-n',
      '-g',
      '-j',
      '-F',
      '-b',
      'com.apple.Safari',
      '-R',
      '-u',
      'https://u.example',
      '--env',
      'FAKE_A=1',
      '--stdin',
      'in.txt',
      '--stdout',
      'out.txt',
      '--stderr',
      'err.txt',
      '--arch',
      'arm64',
      '-t',
      join(ok.cwd, 'notes.txt'),
      '--args',
      '-x',
      'y',
    ]);
    assert.equal(ok.calls[0].env.FAKE_A, undefined);
  });

  it('opens a target after -- as an absolute path, without passing -- on', async () => {
    const result = await scopen({ platform: 'darwin', argv: ['-W', '--', '-weird'] });
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(result.calls[0].argv, ['-W', join(result.cwd, '-weird')]);
  });

  it('gives open -f the standard input', async () => {
    const result = await scopen({ platform: 'darwin', argv: ['-f'], stdin: 'from stdin\n' });
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(result.calls[0].argv, ['-f']);
    assert.equal(result.calls[0].stdin, 'from stdin\n');
  });

  it('opens an app with -a or -b and no target', async () => {
    const result = await scopen({ platform: 'darwin', argv: ['-a', 'Safari'] });
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(result.calls[0].argv, ['-a', 'Safari']);
  });

  it('rejects -s, -d, -v and --size', async () => {
    for (const [argv, shown] of [
      [['-s', '10.15', 'notes.txt'], '-s'],
      [['-d', 'notes.txt'], '-d'],
      [['--download', 'notes.txt'], '--download'],
      [['--view', 'notes.txt'], '--view'],
      [['-v', '--size', 'low', 'notes.txt'], '-v'],
      [['--size=low', 'notes.txt'], '--size'],
    ]) {
      const result = await scopen({ platform: 'darwin', argv });
      assert.equal(result.code, 2, argv.join(' '));
      assert.equal(result.stderr, `scopen: ${shown} is not supported on macOS\n${usage}\n`);
      assert.deepEqual(result.calls, []);
    }
  });

  it('passes the stderr of a failing open through and exits 1', async () => {
    const result = await scopen({
      platform: 'darwin',
      argv: ['notes.txt'],
      extra: { FAKE_FAIL: 'open' },
    });
    assert.equal(result.code, 1);
    assert.equal(result.stderr, 'failed in open\n');
    const quiet = await scopen({
      platform: 'darwin',
      argv: ['notes.txt'],
      extra: { FAKE_QUIET: 'open' },
    });
    assert.equal(quiet.code, 1);
    assert.equal(quiet.stderr, 'scopen: open exited with status 4\n');
  });

  it('says so when open is not on PATH', async () => {
    const result = await scopen({ platform: 'darwin', argv: ['notes.txt'], names: ['xdg-open'] });
    assert.equal(result.code, 1);
    assert.equal(result.stderr, 'scopen: no opener found (tried open)\n');
  });
});

describe('scopen on Linux', () => {
  it('runs xdg-open once per target, in order', async () => {
    const result = await scopen({
      platform: 'linux',
      argv: ['-u', 'mailto:a@example.com', 'https://example.com', 'notes.txt'],
    });
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(
      result.calls.map((call) => [call.name, call.argv]),
      [
        ['xdg-open', ['mailto:a@example.com']],
        ['xdg-open', ['https://example.com']],
        ['xdg-open', [join(result.cwd, 'notes.txt')]],
      ]
    );
  });

  it('falls back to gio open, and treats other Unix systems as Linux', async () => {
    const result = await scopen({
      platform: 'freebsd',
      argv: ['notes.txt'],
      names: ['gio', 'open'],
    });
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(
      result.calls.map((call) => [call.name, call.argv]),
      [['gio', ['open', join(result.cwd, 'notes.txt')]]]
    );
  });

  it('says which openers it tried when none is on PATH', async () => {
    const result = await scopen({ platform: 'linux', argv: ['notes.txt'], names: ['open'] });
    assert.equal(result.code, 1);
    assert.equal(result.stderr, 'scopen: no opener found (tried xdg-open, gio)\n');
  });

  it('stops at the first target that fails, with its stderr', async () => {
    const result = await scopen({
      platform: 'linux',
      argv: ['notes.txt', 'https://example.com'],
      extra: { FAKE_FAIL: 'xdg-open' },
    });
    assert.equal(result.code, 1);
    assert.equal(result.stderr, 'failed in xdg-open\n');
    assert.equal(result.calls.length, 1);
  });

  it('opens nothing when any target is missing', async () => {
    const result = await scopen({ platform: 'linux', argv: ['notes.txt', 'missing.txt'] });
    assert.equal(result.code, 1);
    assert.equal(result.stderr, 'scopen: missing.txt: No such file or directory\n');
    assert.deepEqual(result.calls, []);
  });

  it('reveals a file by opening its directory', async () => {
    const result = await scopen({ platform: 'linux', argv: ['-R', 'sub/page.html'] });
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(result.calls[0].argv, [join(result.cwd, 'sub')]);
  });

  it('saves stdin to a .txt file for -f and opens it', async () => {
    const result = await scopen({ platform: 'linux', argv: ['-f'], stdin: 'piped text\n' });
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.calls[0].argv[0], /\.txt$/);
    assert.equal(result.calls[0].file, 'piped text\n');
    rmSync(dirname(result.calls[0].argv[0]), { recursive: true, force: true });
  });

  it('sets --env for the opener and drops SCOPEN_INSTALL_DIR', async () => {
    const result = await scopen({
      platform: 'linux',
      argv: ['--env', 'FAKE_A=x=y', '--env', 'FAKE_KEPT', 'notes.txt'],
      extra: { FAKE_KEPT: 'kept', SCOPEN_INSTALL_DIR: '/nowhere' },
    });
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(result.calls[0].env, {
      FAKE_A: 'x=y',
      FAKE_KEPT: 'kept',
    });
  });

  it('starts -a APP detached with the targets and then --args', async () => {
    const result = await scopen({
      platform: 'linux',
      argv: ['-a', 'myapp', '-n', 'notes.txt', 'https://example.com', '--args', '--flag', 'v'],
    });
    assert.equal(result.code, 0, result.stderr);
    const calls = await result.later(1);
    assert.deepEqual(
      calls.map((call) => [call.name, call.argv]),
      [['myapp', [join(result.cwd, 'notes.txt'), 'https://example.com', '--flag', 'v']]]
    );
  });

  it('waits for -a APP with -W and reports its failure', async () => {
    const ok = await scopen({ platform: 'linux', argv: ['-W', '-a', 'myapp'] });
    assert.equal(ok.code, 0, ok.stderr);
    assert.equal(ok.stdout, 'out of myapp\n');
    assert.equal(ok.calls.length, 1);
    const failed = await scopen({
      platform: 'linux',
      argv: ['-W', '-a', 'myapp', 'notes.txt'],
      extra: { FAKE_FAIL: 'myapp' },
    });
    assert.equal(failed.code, 1);
    assert.equal(failed.stderr, 'failed in myapp\n');
  });

  it('connects --stdin, --stdout and --stderr to the app', async () => {
    const cwd = workdir();
    writeFileSync(join(cwd, 'in.txt'), 'app input\n');
    const result = await scopen({
      platform: 'linux',
      cwd,
      argv: ['-W', '-a', 'myapp', '--stdin', 'in.txt', '--stdout', 'o.txt', '--stderr', 'e.txt'],
      extra: { FAKE_FAIL: 'myapp', FAKE_STDIN: '1' },
    });
    assert.equal(result.code, 1);
    assert.equal(result.calls[0].stdin, 'app input\n');
    assert.equal(readFileSync(join(cwd, 'o.txt'), 'utf8'), 'out of myapp\n');
    assert.equal(readFileSync(join(cwd, 'e.txt'), 'utf8'), 'failed in myapp\n');
    const missing = await scopen({
      platform: 'linux',
      argv: ['-a', 'myapp', '--stdin', 'nothing.txt'],
    });
    assert.equal(missing.code, 1);
    assert.equal(
      missing.stderr,
      `scopen: ${join(missing.cwd, 'nothing.txt')}: No such file or directory\n`
    );
    assert.deepEqual(await missing.later(0), []);
  });

  it('gives -a APP the stdin file of -f, and runs APP by path', async () => {
    const cwd = workdir();
    const app = join(tools(['myapp']), 'myapp');
    const result = await scopen({
      platform: 'linux',
      cwd,
      argv: ['-W', '-f', '-a', app],
      stdin: 'to the app\n',
    });
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.calls[0].file, 'to the app\n');
  });

  it('says so when APP is not on PATH', async () => {
    const result = await scopen({ platform: 'linux', argv: ['-a', 'nosuchapp', 'notes.txt'] });
    assert.equal(result.code, 1);
    assert.equal(result.stderr, 'scopen: nosuchapp: command not found\n');
  });

  it('rejects what Linux has no opener for', async () => {
    for (const [argv, message] of [
      [['-b', 'id'], '-b is not supported on Linux'],
      [['-e', 'notes.txt'], '-e is not supported on Linux'],
      [['-t', 'notes.txt'], '-t is not supported on Linux'],
      [['-F', 'notes.txt'], '-F is not supported on Linux'],
      [['-g', 'notes.txt'], '-g is not supported on Linux'],
      [['-j', 'notes.txt'], '-j is not supported on Linux'],
      [['--arch', 'x86_64', 'notes.txt'], '--arch is not supported on Linux'],
      [['-W', 'notes.txt'], '-W without -a is not supported on Linux'],
      [['-n', 'notes.txt'], '-n without -a is not supported on Linux'],
      [['--stdout', 'x', 'notes.txt'], '--stdout without -a is not supported on Linux'],
      [['notes.txt', '--args', 'x'], '--args without -a is not supported on Linux'],
      [['-R', '-a', 'myapp', 'notes.txt'], "-R and -a can't be given together"],
      [['-R', 'https://example.com'], '-R takes paths, not URLs'],
      [['--env', '1BAD', 'notes.txt'], '--env needs NAME or NAME=VALUE, not 1BAD'],
    ]) {
      const result = await scopen({ platform: 'linux', argv });
      assert.equal(result.code, 2, argv.join(' '));
      assert.equal(result.stderr, `scopen: ${message}\n${usage}\n`);
      assert.deepEqual(result.calls, []);
    }
  });
});

describe('scopen on Windows', () => {
  const win = (options) =>
    scopen({ platform: 'win32', ...options }).then((result) => ({
      ...result,
      items: result.calls[0]?.env.SCOPEN_ARGV && JSON.parse(result.calls[0].env.SCOPEN_ARGV),
    }));

  it('runs the constant Start-Process script once, with the targets in SCOPEN_ARGV', async () => {
    const result = await win({ argv: ['https://example.com', 'notes.txt'] });
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.calls.length, 1);
    assert.equal(result.calls[0].name, 'powershell.exe');
    assert.deepEqual(result.calls[0].argv, [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      windowsScript,
    ]);
    assert.deepEqual(result.items, [
      { FilePath: 'https://example.com' },
      { FilePath: join(result.cwd, 'notes.txt') },
    ]);
  });

  it('falls back to pwsh.exe, and says what it tried', async () => {
    const result = await win({ argv: ['notes.txt'], names: ['pwsh.exe'] });
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.calls[0].name, 'pwsh.exe');
    const none = await win({ argv: ['notes.txt'], names: ['open'] });
    assert.equal(none.code, 1);
    assert.equal(none.stderr, 'scopen: no opener found (tried powershell.exe, pwsh.exe)\n');
  });

  it('binds -a, -W, -j, --args and the redirections to Start-Process', async () => {
    const result = await win({
      argv: [
        '-a',
        'C:\\Program Files\\App\\app.exe',
        '-W',
        '-j',
        '-n',
        '--stdin',
        'in.txt',
        '--stdout',
        'out.txt',
        '--stderr',
        'err.txt',
        'notes.txt',
        '--args',
        'two words',
        'quote"d',
      ],
    });
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(result.items, [
      {
        FilePath: 'C:\\Program Files\\App\\app.exe',
        ArgumentList: windowsCommandLine([join(result.cwd, 'notes.txt'), 'two words', 'quote"d']),
        Wait: true,
        WindowStyle: 'Hidden',
        RedirectStandardInput: join(result.cwd, 'in.txt'),
        RedirectStandardOutput: join(result.cwd, 'out.txt'),
        RedirectStandardError: join(result.cwd, 'err.txt'),
      },
    ]);
  });

  it('quotes -ArgumentList as Windows programs parse it', () => {
    assert.equal(
      windowsCommandLine(['plain', 'two words', '', 'a"b', 'end\\', 'sp ace\\', 'x\\"y']),
      'plain "two words" "" "a\\"b" end\\ "sp ace\\\\" "x\\\\\\"y"'
    );
  });

  it('reveals with explorer.exe /select, whatever explorer exits with', async () => {
    const result = await win({
      argv: ['-R', 'notes.txt', 'sub/page.html'],
      extra: { FAKE_FAIL: 'explorer.exe' },
    });
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(
      result.calls.map((call) => [call.name, call.argv]),
      [
        ['explorer.exe', [`/select,${join(result.cwd, 'notes.txt')}`]],
        ['explorer.exe', [`/select,${join(result.cwd, 'sub', 'page.html')}`]],
      ]
    );
  });

  it('opens -e, -t and -f in notepad.exe', async () => {
    const edit = await win({ argv: ['-e', 'notes.txt'] });
    assert.equal(edit.code, 0, edit.stderr);
    assert.deepEqual(
      (await edit.later(1)).map((call) => [call.name, call.argv]),
      [['notepad.exe', [join(edit.cwd, 'notes.txt')]]]
    );
    const text = await win({ argv: ['-W', '-t', 'notes.txt'] });
    assert.equal(text.code, 0, text.stderr);
    assert.equal(text.calls[0].name, 'notepad.exe');
    const piped = await win({ argv: ['-W', '-f'], stdin: 'for notepad\n' });
    assert.equal(piped.code, 0, piped.stderr);
    assert.equal(piped.calls[0].name, 'notepad.exe');
    assert.equal(piped.calls[0].file, 'for notepad\n');
    const none = await win({ argv: ['-e', 'notes.txt'], names: ['powershell.exe'] });
    assert.equal(none.code, 1);
    assert.equal(none.stderr, 'scopen: no opener found (tried notepad.exe)\n');
  });

  it('passes --env on to what Start-Process starts, and the script errors through', async () => {
    const result = await win({
      argv: ['--env', 'FAKE_A=1', 'notes.txt'],
      extra: { FAKE_FAIL: 'powershell.exe', SCOPEN_INSTALL_DIR: 'C:\\x' },
    });
    assert.equal(result.code, 1);
    assert.equal(result.stderr, 'failed in powershell.exe\n');
    assert.equal(result.calls[0].env.FAKE_A, '1');
    assert.equal(result.calls[0].env.SCOPEN_INSTALL_DIR, undefined);
  });

  it('rejects what Windows has no opener for', async () => {
    for (const [argv, message] of [
      [['-b', 'id'], '-b is not supported on Windows'],
      [['-F', 'notes.txt'], '-F is not supported on Windows'],
      [['-g', 'notes.txt'], '-g is not supported on Windows'],
      [['--arch', 'arm64', 'notes.txt'], '--arch is not supported on Windows'],
      [['-n', 'notes.txt'], '-n without -a is not supported on Windows'],
      [['--stdin', 'x', 'notes.txt'], '--stdin without -a is not supported on Windows'],
      [['notes.txt', '--args', 'x'], '--args without -a is not supported on Windows'],
      [['-a', 'app', '-e', 'notes.txt'], "-a and -e can't be given together"],
      [['-R', '-t', 'notes.txt'], "-R and -t can't be given together"],
    ]) {
      const result = await win({ argv });
      assert.equal(result.code, 2, argv.join(' '));
      assert.equal(result.stderr, `scopen: ${message}\n${usage}\n`);
      assert.deepEqual(result.calls, []);
    }
  });
});

describe('scopen never hands a target to a shell', () => {
  it('passes a hostile URL and file name through unchanged on every platform', async () => {
    for (const platform of ['darwin', 'linux', 'win32']) {
      const cwd = workdir();
      const file = "it's $(touch PWNED) `x`.txt";
      const result = await scopen({ platform, cwd, argv: [hostile, file] });
      assert.equal(result.code, 0, `${platform}: ${result.stderr}`);
      const passed =
        platform === 'win32'
          ? JSON.parse(result.calls[0].env.SCOPEN_ARGV).map((item) => item.FilePath)
          : result.calls.flatMap((call) => call.argv);
      assert.deepEqual(passed, [hostile, join(cwd, file)], platform);
      if (platform === 'win32') assert.equal(result.calls[0].argv[3], windowsScript);
      assert.equal(pwned(cwd), false, platform);
    }
  });

  it('keeps the PowerShell script free of targets and double quotes', () => {
    assert.doesNotMatch(windowsScript, /"/);
    assert.match(windowsScript, /\$env:SCOPEN_ARGV/);
    assert.match(windowsScript, /Start-Process @params/);
    assert.doesNotMatch(windowsScript, /Invoke-Expression|iex|cmd/i);
  });

  const pwsh = ['pwsh', 'pwsh.exe', 'powershell.exe'].find(
    (name) => spawnSync(name, ['-NoProfile', '-Command', 'exit 0']).status === 0
  );
  it('binds SCOPEN_ARGV to Start-Process in a real PowerShell', { skip: !pwsh }, () => {
    const stub = [
      'function Start-Process {',
      '  param($FilePath, $ArgumentList, [switch]$Wait, $WindowStyle, $RedirectStandardInput, $RedirectStandardOutput, $RedirectStandardError, [switch]$PassThru)',
      '  [Console]::Out.WriteLine((ConvertTo-Json -Compress @{ FilePath = $FilePath; ArgumentList = $ArgumentList; Wait = [bool]$Wait; WindowStyle = $WindowStyle; In = $RedirectStandardInput; PassThru = [bool]$PassThru }))',
      '}',
      '',
    ].join('\n');
    const items = [
      { FilePath: hostile },
      {
        FilePath: 'app.exe',
        ArgumentList: windowsCommandLine(['a b', 'c"d']),
        Wait: true,
        WindowStyle: 'Hidden',
        RedirectStandardInput: '/in',
      },
    ];
    const cwd = workdir();
    const result = spawnSync(
      pwsh,
      ['-NoProfile', '-NonInteractive', '-Command', stub + windowsScript],
      {
        cwd,
        env: { ...process.env, SCOPEN_ARGV: JSON.stringify(items) },
        encoding: 'utf8',
      }
    );
    assert.equal(result.status, 0, result.stderr);
    const seen = result.stdout
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    assert.deepEqual(seen, [
      {
        FilePath: hostile,
        ArgumentList: null,
        Wait: false,
        WindowStyle: null,
        In: null,
        PassThru: false,
      },
      {
        FilePath: 'app.exe',
        ArgumentList: '"a b" "c\\"d"',
        Wait: true,
        WindowStyle: 'Hidden',
        In: '/in',
        PassThru: true,
      },
    ]);
    assert.equal(pwned(cwd), false);
  });
});

describe('scopen options', () => {
  it('prints the usage to stderr and exits 2 without arguments', async () => {
    const result = await scopen({ platform: 'linux', argv: [] });
    assert.deepEqual([result.code, result.stdout, result.stderr], [2, '', `${usage}\n`]);
  });

  it('prints the help for -h or --help anywhere among the options, checking nothing else', async () => {
    for (const argv of [
      ['-h'],
      ['--help'],
      ['-x', '-h', 'NSView'],
      ['-W', '--help', '--upgrade'],
    ]) {
      const result = await scopen({ platform: 'linux', argv });
      assert.equal(result.code, 0, argv.join(' '));
      assert.match(result.stdout, /^usage: scopen /);
      assert.match(result.stdout, /\n {2}--upgrade {7}/);
      assert.equal(result.stderr, '');
      assert.deepEqual(result.calls, []);
    }
  });

  it('reports usage errors with exit 2', async () => {
    for (const [argv, message] of [
      [['-x', 'notes.txt'], 'unknown option -x'],
      [['-Wx', 'notes.txt'], 'unknown option -x'],
      [['--nope', 'notes.txt'], 'unknown option --nope'],
      [['-a'], '-a needs a value'],
      [['--env'], '--env needs a value'],
      [['--version=1'], '--version takes no value'],
      [['--version', 'x'], '--version takes no other arguments'],
      [['--upgrade', '--version'], '--version takes no other arguments'],
      [['-W'], 'no target'],
      [['-e', '-t', 'notes.txt'], "-e and -t can't be given together"],
      [['-f', 'notes.txt'], '-f takes no targets'],
    ]) {
      const result = await scopen({ platform: 'darwin', argv });
      assert.equal(result.code, 2, argv.join(' '));
      assert.equal(result.stderr, `scopen: ${message}\n${usage}\n`);
      assert.deepEqual(result.calls, []);
    }
  });

  it('reads an option after the first target as a target', async () => {
    const result = await scopen({ platform: 'darwin', argv: ['notes.txt', '-W'] });
    assert.equal(result.code, 1);
    assert.equal(result.stderr, 'scopen: -W: No such file or directory\n');
    const dash = await scopen({ platform: 'darwin', argv: ['notes.txt', '-weird'] });
    assert.equal(dash.code, 0, dash.stderr);
    assert.deepEqual(dash.calls[0].argv, [join(dash.cwd, 'notes.txt'), join(dash.cwd, '-weird')]);
  });

  it('prints its version', async () => {
    const result = await scopen({ platform: 'linux', argv: ['--version'] });
    assert.deepEqual([result.code, result.stdout], [0, `${version}\n`]);
  });

  it('runs as the package bin', () => {
    const result = spawnSync(process.execPath, [join(root, 'host/scopen.mjs'), '--version'], {
      encoding: 'utf8',
    });
    assert.deepEqual([result.status, result.stdout], [0, `${version}\n`]);
    const bad = spawnSync(process.execPath, [join(root, 'host/scopen.mjs'), '--nope'], {
      encoding: 'utf8',
    });
    assert.equal(bad.status, 2);
  });
});

describe('scopen --upgrade', () => {
  let server;
  let url;
  const files = new Map();
  before(async () => {
    server = createServer((request, response) => {
      const body = files.get(request.url);
      response.writeHead(body === undefined ? 404 : 200);
      response.end(body ?? 'not found');
    });
    await new Promise((done) => server.listen(0, '127.0.0.1', done));
    url = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => server.close());

  const installer = (body) => {
    const name = `/r${files.size}`;
    files.set(`${name}/install.sh`, `#!/bin/sh\n${body}\n`);
    return `${url}${name}`;
  };

  it('prints the npm command when npm installed it', async () => {
    const result = await scopen({ platform: 'linux', argv: ['--upgrade'] });
    assert.deepEqual(
      [result.code, result.stdout],
      [0, 'npm install -g @ai-ecoverse/slicc-open@latest\n']
    );
  });

  it('runs the latest install.sh with --dir and prints old → new', async () => {
    const log = join(mkdtempSync(join(scratch, 'up-')), 'args');
    const at = installer(
      `printf '%s\\n' "$@" "\${SCOPEN_INSTALL_DIR:-unset}" > '${log}'\necho progress >&2\necho 'scopen 99.1.0 installed to /x/scopen'`
    );
    const shell = dirname(
      spawnSync('sh', ['-c', 'command -v sh'], { encoding: 'utf8' }).stdout.trim()
    );
    const result = await scopen({
      platform: 'linux',
      argv: ['--upgrade'],
      extra: { PATH: shell, SCOPEN_INSTALL_DIR: '/opt/my bin', SLICC_INSTALL_BASE_URL: `${at}/` },
    });
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stdout, `scopen: ${version} → 99.1.0\n`);
    assert.equal(result.stderr, 'progress\n');
    assert.deepEqual(readFileSync(log, 'utf8').split('\n'), ['--dir', '/opt/my bin', 'unset', '']);
  });

  it('says when it is already up to date', async () => {
    const at = installer(`echo 'scopen ${version} installed to /x/scopen'`);
    const result = await scopen({
      platform: 'darwin',
      argv: ['--upgrade'],
      extra: { PATH: '/bin', SCOPEN_INSTALL_DIR: '/d', SLICC_INSTALL_BASE_URL: at },
    });
    assert.deepEqual(
      [result.code, result.stdout],
      [0, `scopen: already up to date (${version})\n`]
    );
  });

  it('passes a failing installer stderr through and exits 1', async () => {
    for (const [body, stderr] of [
      ['echo broken >&2; exit 5', 'broken\n'],
      ['echo nothing useful', 'scopen: install.sh did not say which version it installed\n'],
    ]) {
      const at = installer(body);
      const result = await scopen({
        platform: 'linux',
        argv: ['--upgrade'],
        extra: { PATH: '/bin', SCOPEN_INSTALL_DIR: '/d', SLICC_INSTALL_BASE_URL: at },
      });
      assert.deepEqual([result.code, result.stdout, result.stderr], [1, '', stderr]);
    }
  });

  it('exits 1 when the installer cannot be downloaded or run', async () => {
    const missing = await scopen({
      platform: 'linux',
      argv: ['--upgrade'],
      extra: { SCOPEN_INSTALL_DIR: '/d', SLICC_INSTALL_BASE_URL: `${url}/gone` },
    });
    assert.equal(missing.code, 1);
    assert.equal(missing.stderr, `scopen: could not download ${url}/gone/install.sh: HTTP 404\n`);
    const refused = await scopen({
      platform: 'linux',
      argv: ['--upgrade'],
      extra: { SCOPEN_INSTALL_DIR: '/d', SLICC_INSTALL_BASE_URL: 'http://127.0.0.1:1' },
    });
    assert.equal(refused.code, 1);
    assert.match(
      refused.stderr,
      /^scopen: could not download http:\/\/127\.0\.0\.1:1\/install\.sh: /
    );
    const at = installer('exit 0');
    const noShell = await scopen({
      platform: 'linux',
      argv: ['--upgrade'],
      names: [],
      extra: { SCOPEN_INSTALL_DIR: '/d', SLICC_INSTALL_BASE_URL: at },
    });
    assert.equal(noShell.code, 1);
    assert.equal(noShell.stderr, 'scopen: no shell found to run install.sh (tried sh)\n');
  });

  it('runs install.ps1 with -Dir through PowerShell on Windows', async () => {
    files.set('/win/install.ps1', 'param($Dir)');
    const result = await scopen({
      platform: 'win32',
      argv: ['--upgrade'],
      extra: {
        SCOPEN_INSTALL_DIR: 'C:\\Users\\me\\bin',
        SLICC_INSTALL_BASE_URL: `${url}/win`,
        FAKE_INSTALLED: '99.2.0',
      },
    });
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stdout, `scopen: ${version} → 99.2.0\n`);
    const [call] = result.calls;
    assert.equal(call.name, 'powershell.exe');
    assert.deepEqual(call.argv.slice(0, 5), [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
    ]);
    assert.match(call.argv[5], /install\.ps1$/);
    assert.deepEqual(call.argv.slice(6), ['-Dir', 'C:\\Users\\me\\bin']);
    assert.equal(call.file, 'param($Dir)');
    assert.equal(call.env.SCOPEN_INSTALL_DIR, undefined);
    const none = await scopen({
      platform: 'win32',
      argv: ['--upgrade'],
      names: [],
      extra: { SCOPEN_INSTALL_DIR: 'C:\\d', SLICC_INSTALL_BASE_URL: `${url}/win` },
    });
    assert.equal(
      none.stderr,
      'scopen: no shell found to run install.ps1 (tried powershell.exe, pwsh.exe)\n'
    );
  });

  it('is run by the spawned bin too', async () => {
    const child = spawn(process.execPath, [join(root, 'host/scopen.mjs'), '--upgrade'], {
      env: { ...base(), PATH: delimiter },
    });
    let out = '';
    child.stdout.on('data', (chunk) => {
      out += chunk;
    });
    const code = await new Promise((done) => child.on('close', done));
    assert.deepEqual([code, out], [0, 'npm install -g @ai-ecoverse/slicc-open@latest\n']);
  });
});
