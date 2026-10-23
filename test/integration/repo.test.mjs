import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, it } from 'node:test';

const root = resolve(import.meta.dirname, '../..');
const read = (path) => readFileSync(join(root, path), 'utf8');
const pkg = JSON.parse(read('package.json'));
const tracked = () => {
  const run = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(run.status, 0, run.stderr);
  return run.stdout.split('\n').filter(Boolean);
};
const listed = (dir) => (existsSync(join(root, dir)) ? readdirSync(join(root, dir)) : []);

describe('the repository', () => {
  it('has ci.yml as its only workflow, on the pipeline at the devDependency version', () => {
    assert.deepEqual(readdirSync(join(root, '.github/workflows')), ['ci.yml']);
    const ci = read('.github/workflows/ci.yml');
    const uses = [...ci.matchAll(/^\s*uses:\s*(\S+)\s*$/gm)].map((match) => match[1]);
    assert.deepEqual(uses, [
      `ai-ecoverse/slicc-shared-web/.github/workflows/pipeline.yml@v${pkg.devDependencies['@ai-ecoverse/slicc-shared-web']}`,
    ]);
    assert.match(ci, /^\s*secrets: inherit$/m);
    assert.doesNotMatch(ci, /runs-on|workflow_dispatch|schedule|#/);
    for (const scope of [
      'contents',
      'issues',
      'pull-requests',
      'statuses',
      'id-token',
      'attestations',
    ]) {
      assert.match(ci, new RegExp(`^  ${scope}: write$`, 'm'), scope);
    }
    assert.match(ci, /^ {2}actions: read$/m);
    assert.match(ci, /cancel-in-progress: \$\{\{ github\.event_name == 'pull_request' \}\}/);
    const glob = /^\s*test-glob:\s*(\S+)$/m.exec(ci)?.[1];
    assert.ok(glob && pkg.scripts.test.endsWith(` ${glob}`), pkg.scripts.test);
    assert.match(ci, /^ {6}windows-test: npm run test:windows$/m);
    assert.match(
      pkg.scripts['test:windows'],
      /^node --test .* test\/integration\/windows\.test\.mjs$/
    );
  });

  it('pins slicc-shared-web and its tools exactly, on the 2.x line from 2.12.0', () => {
    for (const [name, version] of Object.entries(pkg.devDependencies)) {
      assert.match(version, /^(npm:@[\w-]+\/[\w-]+@)?\d+\.\d+\.\d+(-[\w.]+)?$/, name);
    }
    const [major, minor] = pkg.devDependencies['@ai-ecoverse/slicc-shared-web']
      .split('.')
      .map(Number);
    assert.ok(major === 2 && minor >= 12, 'windows-test needs slicc-shared-web 2.12.0 or later');
    const lefthook = read('lefthook.yml');
    assert.match(lefthook, /^assert_lefthook_installed: true$/m);
    assert.match(lefthook, /node_modules\/@ai-ecoverse\/slicc-shared-web\/lefthook\.yml$/m);
    assert.match(lefthook, /slicc-shared-web hooks missing, run npm install'; exit 1;/);
    assert.equal(pkg.scripts.prepare, 'slicc-install-hooks');
    assert.equal(
      read('.githooks/pre-commit'),
      '#!/bin/sh\nhook="${0%/*}/../node_modules/.git-hooks/${0##*/}"\n[ -x "$hook" ] || { echo "${0##*/}: run npm install" >&2; exit 1; }\nexec "$hook" "$@"\n'
    );
    assert.deepEqual(JSON.parse(read('renovate.json')).extends, [
      'github>ai-ecoverse/slicc-shared-web',
    ]);
  });

  it('is the package the README describes', () => {
    assert.equal(pkg.name, '@ai-ecoverse/slicc-open');
    assert.equal(pkg.license, 'Apache-2.0');
    assert.equal(pkg.type, 'module');
    assert.equal(pkg.engines.node, '>=24');
    assert.deepEqual(pkg.bin, { scopen: 'host/scopen.mjs' });
    assert.deepEqual(pkg.slicc.unitSources, ['host']);
    assert.deepEqual(pkg.slicc.commands, {
      open: { script: 'bin/open' },
      'xdg-open': { script: 'bin/xdg-open' },
      scopen: { script: 'bin/scopen' },
    });
    assert.equal(pkg.engines['slicc-kernel'], '>=1.153.0');
    assert.match(pkg.scripts.lint, /shellcheck -s sh -e SC1091 install\.sh bin\/\*/);
    assert.match(pkg.scripts.lint, /dash -n/);
    assert.match(
      read('lefthook.yml'),
      /glob: "bin\/\*"\n\s+run: npm run --silent test:unit && npx --no-install slicc-diff-cover/
    );
  });

  it('publishes to npm from ci.yml through semantic-release, with provenance', () => {
    assert.equal(pkg.fledgling.workflow, 'ci.yml');
    assert.equal(pkg.fledgling.repo, 'ai-ecoverse/slicc-open');
    assert.equal(pkg.publishConfig.access, 'public');
    assert.equal(pkg.publishConfig.provenance, true);
    const release = JSON.parse(read('.releaserc.json'));
    assert.deepEqual(release.branches, ['main']);
    assert.ok(release.plugins.some((entry) => [entry].flat()[0] === '@semantic-release/npm'));
    assert.doesNotMatch(JSON.stringify(release), /npmPublish/);
  });

  it('attaches the tarball, SHA256SUMS, install.sh and install.ps1 to the GitHub release', () => {
    const release = JSON.parse(read('.releaserc.json'));
    const plugin = (name) => release.plugins.find((entry) => [entry].flat()[0] === name);
    assert.deepEqual(plugin('@semantic-release/npm'), [
      '@semantic-release/npm',
      { tarballDir: 'release' },
    ]);
    assert.deepEqual(plugin('@semantic-release/exec')[1], {
      prepareCmd: 'node scripts/assets.mjs release ${nextRelease.version}',
    });
    const names = release.plugins.map((entry) => [entry].flat()[0]);
    assert.ok(names.indexOf('@semantic-release/npm') < names.indexOf('@semantic-release/exec'));
    assert.ok(names.indexOf('@semantic-release/exec') < names.indexOf('@semantic-release/github'));
    assert.deepEqual(
      plugin('@semantic-release/github')[1].assets.map((asset) => asset.path),
      [
        'release/slicc-open-*.tgz',
        'release/SHA256SUMS',
        'release/install.sh',
        'release/install.ps1',
      ]
    );
    assert.ok(existsSync(join(root, 'install.sh')));
    assert.ok(existsSync(join(root, 'install.ps1')));
    assert.match(read('.gitignore'), /^release\/$/m);
  });

  it('keeps Markdown to README.md and AGENTS.md, with no CLAUDE.md', () => {
    const markdown = tracked().filter((path) => /\.md$/i.test(path) || /CLAUDE/i.test(path));
    assert.deepEqual(markdown.sort(), ['AGENTS.md', 'README.md']);
    assert.ok([...read('AGENTS.md')].length <= 1000);
  });

  it('has no comments in its code and config', () => {
    const hash = /\.(ya?ml|sh|ps1)$|^\.git(ignore|attributes)$|^bin\/|^\.githooks\//;
    const slash = /\.(m?js|json)$/;
    for (const path of tracked()) {
      if (!existsSync(join(root, path))) continue;
      const text = read(path);
      if (hash.test(path)) {
        const lines = text
          .split('\n')
          .filter((line, index) => !(index === 0 && line.startsWith('#!')));
        assert.ok(!lines.some((line) => /^\s*#/.test(line)), path);
      }
      if (slash.test(path)) assert.doesNotMatch(text, /^\s*(\/\/|\/\*)/m, path);
    }
  });

  it('packs only the license, the README, package.json, bin and host', () => {
    const pack = spawnSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
      cwd: root,
      encoding: 'utf8',
    });
    assert.equal(pack.status, 0, pack.stderr);
    const files = JSON.parse(pack.stdout)[0]
      .files.map((file) => file.path)
      .sort();
    const expected = [
      'LICENSE',
      'README.md',
      'package.json',
      ...listed('bin').map((name) => `bin/${name}`),
      ...listed('host').map((name) => `host/${name}`),
    ].sort();
    assert.deepEqual(files, expected);
    for (const [name, command] of Object.entries(pkg.slicc.commands ?? {})) {
      assert.ok(files.includes(command.script), name);
    }
  });
});
