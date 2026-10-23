import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { windowsCommandLine } from '../../host/windows.mjs';
import { fakeExe } from './fake-windows.mjs';

const root = resolve(import.meta.dirname, '../..');
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const installPs1 = join(root, 'install.ps1');
const onWindows = process.platform === 'win32';
const system = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32');
const powershell = join(system, 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const cmd = join(system, 'cmd.exe');

function withPath(env, value) {
  const out = {};
  for (const [key, entry] of Object.entries(env)) {
    if (key.toUpperCase() !== 'PATH') out[key] = entry;
  }
  out.PATH = value;
  return out;
}

function pathOf(env) {
  return Object.entries(env).find(([key]) => key.toUpperCase() === 'PATH')?.[1] ?? '';
}

function clean(extra = {}) {
  const out = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (
      !['SCOPEN_INSTALL_DIR', 'NODE_USE_ENV_PROXY', 'NODE_OPTIONS', 'PSMODULEPATH'].includes(
        key.toUpperCase()
      )
    ) {
      out[key] = value;
    }
  }
  return { ...out, ...extra };
}

function run(file, args, options = {}) {
  return new Promise((done) => {
    const child = spawn(file, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => done({ status: -1, stdout, stderr: `${stderr}${error.message}` }));
    child.on('close', (status) => done({ status, stdout, stderr }));
  });
}

function lines(text) {
  return text.split(/\r?\n/).filter(Boolean);
}

function ps(shell, script, env) {
  return run(
    shell,
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    {
      env,
    }
  );
}

function batch(line, env) {
  return run(cmd, ['/d', '/s', '/c', `"${line}"`], { env, windowsVerbatimArguments: true });
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

describe('on real Windows', { skip: !onWindows && 'not Windows' }, () => {
  let scratch;
  let server;
  let url;
  let served;
  let userPath;
  let pwsh;

  function npm(args, cwd) {
    const cli = /\.c?js$/.test(process.env.npm_execpath ?? '')
      ? process.env.npm_execpath
      : join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
    return spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8' });
  }

  function release(name, as) {
    const dir = join(served, name);
    mkdirSync(dir, { recursive: true });
    const source = mkdtempSync(join(scratch, 'source-'));
    for (const file of ['LICENSE', 'README.md', 'package.json', 'host']) {
      cpSync(join(root, file), join(source, file), { recursive: true });
    }
    const pkg = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'));
    pkg.version = as;
    delete pkg.scripts;
    writeFileSync(join(source, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);
    const pack = npm(['pack', '--ignore-scripts', '--pack-destination', dir], source);
    assert.equal(pack.status, 0, `${pack.stdout}${pack.stderr}${pack.error?.message ?? ''}`);
    const assets = spawnSync(process.execPath, [join(root, 'scripts', 'assets.mjs'), dir, as], {
      encoding: 'utf8',
    });
    assert.equal(assets.status, 0, assets.stderr);
    return `${url}/${name}`;
  }

  function install(shell, dir, local, base, extra = {}) {
    return run(
      shell,
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        installPs1,
        '-Dir',
        dir,
      ],
      { env: clean({ LOCALAPPDATA: local, SLICC_INSTALL_BASE_URL: base, ...extra }) }
    );
  }

  function fakes() {
    const dir = mkdtempSync(join(scratch, 'fakes-'));
    const log = join(dir, 'calls.log');
    fakeExe(
      dir,
      'powershell.exe',
      [
        "const fs = require('node:fs');",
        'fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify({ argv: process.argv.slice(2), items: JSON.parse(process.env.SCOPEN_ARGV), dir: process.env.SCOPEN_INSTALL_DIR ?? null }) + "\\n");',
        '',
      ].join('\n')
    );
    const calls = () =>
      existsSync(log) ? lines(readFileSync(log, 'utf8')).map((line) => JSON.parse(line)) : [];
    return { dir, log, calls };
  }

  before(async () => {
    scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'slicc-open-windows-')));
    served = join(scratch, 'served');
    mkdirSync(served);
    server = createServer((request, response) => {
      const path = resolve(served, `.${decodeURIComponent(request.url.split('?')[0])}`);
      if (!path.startsWith(served + sep) || !existsSync(path)) {
        response.writeHead(404);
        response.end();
        return;
      }
      response.writeHead(200);
      response.end(readFileSync(path));
    });
    await new Promise((done) => server.listen(0, '127.0.0.1', done));
    url = `http://127.0.0.1:${server.address().port}`;
    const saved = spawnSync(
      powershell,
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        "[Environment]::GetEnvironmentVariable('Path', 'User')",
      ],
      { encoding: 'utf8' }
    );
    userPath = saved.stdout.replace(/\r?\n$/, '');
    pwsh =
      spawnSync('pwsh', ['-NoProfile', '-Command', 'exit 0']).status === 0 ? 'pwsh' : undefined;
  });

  after(() => {
    server?.close();
    spawnSync(
      powershell,
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        "[Environment]::SetEnvironmentVariable('Path', $(if ($env:SLICC_USER_PATH) { $env:SLICC_USER_PATH } else { $null }), 'User')",
      ],
      { env: { ...process.env, SLICC_USER_PATH: userPath } }
    );
    if (scratch) rmSync(scratch, { recursive: true, force: true });
  });

  for (const shell of ['powershell.exe', 'pwsh']) {
    it(`installs with ${shell}, and both launchers run, keep their arguments and leak nothing`, async (t) => {
      const exe = shell === 'pwsh' ? pwsh : powershell;
      if (!exe) {
        t.skip('pwsh is not installed');
        return;
      }
      const base = release(`r-${shell}`, version);
      const local = mkdtempSync(join(scratch, 'local-'));
      const bin = join(local, "my 'bin' (x86) & 100%");
      const result = await install(exe, bin, local, base);
      assert.equal(result.status, 0, result.stderr);
      const out = lines(result.stdout);
      assert.equal(out[0], `scopen ${version} installed to ${join(bin, 'scopen.ps1')}`);
      assert.ok(existsSync(join(local, 'slicc-open', version, 'host', 'scopen.mjs')));
      const ps1 = join(bin, 'scopen.ps1');
      const launcher = join(bin, 'scopen.cmd');
      assert.deepEqual([...readFileSync(ps1).subarray(0, 3)], [0xef, 0xbb, 0xbf]);

      const env = clean();
      for (const argv of [['--version'], ['--help']]) {
        const viaCmd = await batch(`"${launcher}" ${argv.join(' ')}`, env);
        const viaPs = await ps(exe, `& $env:T_LAUNCHER ${argv.join(' ')}; exit $LASTEXITCODE`, {
          ...env,
          T_LAUNCHER: ps1,
        });
        for (const [how, got] of [
          ['cmd', viaCmd],
          ['ps1', viaPs],
        ]) {
          assert.equal(got.status, 0, `${how} ${argv}: ${got.stderr}`);
          if (argv[0] === '--version') assert.equal(got.stdout.trim(), version, how);
          else assert.match(got.stdout, /^usage: scopen /, how);
        }
      }
      assert.equal((await batch(`"${launcher}" --nope`, env)).status, 2);
      assert.equal(
        (
          await ps(exe, '& $env:T_LAUNCHER --nope 2>$null; exit $LASTEXITCODE', {
            ...env,
            T_LAUNCHER: ps1,
          })
        ).status,
        2
      );

      const pages = await batch(`chcp & "${launcher}" --version & chcp`, env);
      const [before, , after] = lines(pages.stdout);
      assert.equal(before, after, pages.stdout);

      const leak = await batch(
        `"${launcher}" --version & set SCOPEN_INSTALL_DIR & set NODE_USE_ENV_PROXY`,
        env
      );
      assert.equal(leak.stdout.trim(), version, leak.stdout);
      const show = (name) =>
        `'${name}=' + $(if ($null -eq $env:${name}) { 'unset' } else { $env:${name} })`;
      for (const [setup, dir, proxy] of [
        ["$env:SCOPEN_INSTALL_DIR = 'before'; $env:NODE_USE_ENV_PROXY = '0'", 'before', '0'],
        ['', 'unset', 'unset'],
      ]) {
        const session = await ps(
          exe,
          `${setup}; & $env:T_LAUNCHER --version | Out-Null; 'code=' + $LASTEXITCODE; ${show('SCOPEN_INSTALL_DIR')}; ${show('NODE_USE_ENV_PROXY')}`,
          { ...env, T_LAUNCHER: ps1 }
        );
        assert.deepEqual(
          lines(session.stdout),
          ['code=0', `SCOPEN_INSTALL_DIR=${dir}`, `NODE_USE_ENV_PROXY=${proxy}`],
          session.stderr
        );
      }

      const fake = fakes();
      const work = mkdtempSync(join(scratch, 'work-'));
      const file = join(work, "a ) & ^ 'f' b.txt");
      writeFileSync(file, 'x\n');
      const tricky = ['a )&%^ b "q" c', 'x"y\\', 'sp ace\\', 'tail\\', '', '%SCOPEN_NOPE%', "it's"];
      const typed = ['a )&%^ b "q" c', 'x"y" z', 'tail\\', '%SCOPEN_NOPE%'];
      const faked = withPath(clean({ FAKE_LOG: fake.log }), `${fake.dir};${pathOf(process.env)}`);
      const modes =
        shell === 'pwsh'
          ? [
              '',
              "$PSNativeCommandArgumentPassing = 'Legacy'; ",
              'Remove-Variable PSNativeCommandArgumentPassing; ',
            ]
          : [''];
      for (const mode of modes) {
        const viaPs = await ps(
          exe,
          `${mode}$a = ConvertFrom-Json $env:T_ARGS; & $env:T_LAUNCHER -a myapp $env:T_FILE --args @a; exit $LASTEXITCODE`,
          { ...faked, T_LAUNCHER: ps1, T_FILE: file, T_ARGS: JSON.stringify(tricky) }
        );
        assert.equal(viaPs.status, 0, `${mode}${viaPs.stderr}`);
      }
      for (const mode of modes) {
        const listed = await ps(
          exe,
          `${mode}& $env:T_LAUNCHER -a myapp --args a,'b c' d; exit $LASTEXITCODE`,
          { ...faked, T_LAUNCHER: ps1 }
        );
        assert.equal(listed.status, 0, `${mode}${listed.stderr}`);
      }
      const viaCmd = await batch(
        `"${launcher}" -a myapp "${file}" --args "a )&%^ b \\"q\\" c" "x\\"y\\" z" tail\\ %SCOPEN_NOPE%`,
        faked
      );
      assert.equal(viaCmd.status, 0, viaCmd.stderr);
      const calls = fake.calls();
      const lists = calls.splice(modes.length, modes.length);
      for (const [index, mode] of modes.entries()) {
        assert.deepEqual(
          lists[index].items,
          [{ FilePath: 'myapp', ArgumentList: windowsCommandLine(['a', 'b c', 'd']) }],
          `list ${mode}`
        );
      }
      const wanted = [...modes.map((mode) => [`ps1 ${mode}`, tricky]), ['cmd', typed]];
      assert.equal(calls.length, wanted.length, JSON.stringify(calls));
      for (const [index, [how, args]] of wanted.entries()) {
        assert.deepEqual(
          calls[index].items,
          [{ FilePath: 'myapp', ArgumentList: windowsCommandLine([file, ...args]) }],
          how
        );
        assert.equal(calls[index].argv[0], '-NoProfile', how);
        assert.equal(calls[index].dir, null, how);
      }

      const added = out.find((line) => line.startsWith('Added '));
      const undo = out.find((line) => line.startsWith('To undo: '));
      if (shell === 'powershell.exe') {
        assert.equal(added, `Added ${bin} to your user PATH; open a new terminal to use scopen`);
        const listed = await ps(
          powershell,
          "[Environment]::GetEnvironmentVariable('Path', 'User')",
          clean()
        );
        assert.ok(listed.stdout.trim().split(';').includes(bin), listed.stdout);
        const undone = await ps(
          powershell,
          `${undo.slice('To undo: '.length)}; [Environment]::GetEnvironmentVariable('Path', 'User')`,
          clean()
        );
        assert.equal(undone.status, 0, undone.stderr);
        assert.ok(!undone.stdout.trim().split(';').includes(bin), undone.stdout);
      }
    });
  }

  it('upgrades in place from the installed scopen.cmd and scopen.ps1', async () => {
    const local = mkdtempSync(join(scratch, 'local-'));
    const bin = join(local, 'bin');
    const first = await install(powershell, bin, local, release('old', version));
    assert.equal(first.status, 0, first.stderr);
    const newer = release('new', '99.0.0');
    const modules = pwsh
      ? spawnSync(pwsh, ['-NoProfile', '-Command', '$env:PSModulePath'], {
          encoding: 'utf8',
        }).stdout.trim()
      : join(process.env.ProgramFiles, 'PowerShell', '7', 'Modules');
    const env = clean({
      LOCALAPPDATA: local,
      SLICC_INSTALL_BASE_URL: newer,
      PSModulePath: modules,
    });
    const upgraded = await batch(`"${join(bin, 'scopen.cmd')}" --upgrade`, env);
    assert.equal(upgraded.status, 0, upgraded.stderr);
    assert.equal(upgraded.stdout, `scopen: ${version} → 99.0.0\n`);
    const reported = await batch(`"${join(bin, 'scopen.cmd')}" --version`, clean());
    assert.equal(reported.stdout.trim(), '99.0.0');
    assert.ok(existsSync(join(local, 'slicc-open', '99.0.0', 'host', 'scopen.mjs')));
    const again = await ps(powershell, '& $env:T_LAUNCHER --upgrade; exit $LASTEXITCODE', {
      ...env,
      T_LAUNCHER: join(bin, 'scopen.ps1'),
    });
    assert.equal(again.status, 0, again.stderr);
    assert.equal(again.stdout.trim(), 'scopen: already up to date (99.0.0)');
  });

  it('downloads Node as a .zip when PATH has none, and the launchers use it', async () => {
    const arch = { AMD64: 'x64', ARM64: 'arm64' }[process.env.PROCESSOR_ARCHITECTURE];
    const dist = join(served, 'dist');
    const name = `node-v24.99.0-win-${arch}`;
    const build = join(scratch, 'build');
    mkdirSync(join(build, name), { recursive: true });
    copyFileSync(process.execPath, join(build, name, 'node.exe'));
    mkdirSync(join(dist, 'v24.99.0'), { recursive: true });
    const archive = join(dist, 'v24.99.0', `${name}.zip`);
    const zipped = spawnSync(
      join(system, 'tar.exe'),
      ['-a', '-c', '--options', 'zip:compression=store', '-f', `${name}.zip`, '-C', build, name],
      { cwd: dirname(archive), encoding: 'utf8' }
    );
    assert.equal(zipped.status, 0, zipped.stderr);
    writeFileSync(
      join(dist, 'v24.99.0', 'SHASUMS256.txt'),
      `${'0'.repeat(64)}  ${name}.7z\n${sha256(archive)}  ${name}.zip\n`
    );
    writeFileSync(
      join(dist, 'index.json'),
      JSON.stringify([
        { version: 'v25.0.0', lts: false },
        { version: 'v24.99.0', lts: 'Krypton' },
        { version: 'v22.0.0', lts: 'Jod' },
      ])
    );
    const local = mkdtempSync(join(scratch, 'local-'));
    const bin = join(local, 'bin');
    const bare = `${system};${dirname(system)};${dirname(powershell)}`;
    const result = await run(
      powershell,
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        installPs1,
        '-Dir',
        bin,
      ],
      {
        env: withPath(
          clean({
            LOCALAPPDATA: local,
            SLICC_INSTALL_BASE_URL: release('zip', version),
            SLICC_NODE_DIST_BASE: `${url}/dist`,
          }),
          bare
        ),
      }
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /Node v24\.99\.0 installed to /);
    const managed = join(local, 'slicc-open', 'node', 'node.exe');
    assert.ok(existsSync(managed));
    assert.ok(readFileSync(join(bin, 'scopen.ps1'), 'utf8').includes(`'${managed}'`));
    assert.ok(readFileSync(join(bin, 'scopen.cmd'), 'utf8').includes(`"${managed}"`));
    const reported = await batch(`"${join(bin, 'scopen.cmd')}" --version`, withPath(clean(), bare));
    assert.equal(reported.stdout.trim(), version, reported.stderr);
  });
});
