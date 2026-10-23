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
  });

  it('pins slicc-shared-web and its tools exactly, on the 2.x line', () => {
    for (const [name, version] of Object.entries(pkg.devDependencies)) {
      assert.match(version, /^\d+\.\d+\.\d+$/, name);
    }
    assert.match(pkg.devDependencies['@ai-ecoverse/slicc-shared-web'], /^2\./);
    const lefthook = read('lefthook.yml');
    assert.match(lefthook, /^assert_lefthook_installed: true$/m);
    assert.match(lefthook, /node_modules\/@ai-ecoverse\/slicc-shared-web\/lefthook\.yml$/m);
    assert.match(lefthook, /slicc-shared-web hooks missing, run npm install'; exit 1;/);
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
    for (const name of Object.keys(pkg.slicc.commands ?? {})) {
      assert.ok(['open', 'xdg-open', 'scopen'].includes(name), name);
    }
  });

  it('publishes to npm from ci.yml through semantic-release, with provenance', () => {
    assert.equal(pkg.fledgling.workflow, 'ci.yml');
    assert.equal(pkg.fledgling.repo, 'ai-ecoverse/slicc-open');
    assert.equal(pkg.publishConfig.access, 'public');
    assert.equal(pkg.publishConfig.provenance, true);
    const release = JSON.parse(read('.releaserc.json'));
    assert.deepEqual(release.branches, ['main']);
    assert.ok(release.plugins.includes('@semantic-release/npm'));
    assert.doesNotMatch(JSON.stringify(release), /npmPublish/);
  });

  it('keeps Markdown to README.md and AGENTS.md, with no CLAUDE.md', () => {
    const markdown = tracked().filter((path) => /\.md$/i.test(path) || /CLAUDE/i.test(path));
    assert.deepEqual(markdown.sort(), ['AGENTS.md', 'README.md']);
    assert.ok([...read('AGENTS.md')].length <= 1000);
  });

  it('has no comments in its code and config', () => {
    const hash = /\.(ya?ml|sh)$|^\.git(ignore|attributes)$|^bin\//;
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
