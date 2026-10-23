import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';
import { boot, bootOld } from './kernel.mjs';

const root = resolve(import.meta.dirname, '../..');
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const usage = 'usage: open [-e | -t | -f | -d | -v | -R] [-gn] [-u URL] [--] [TARGET ...]\n';
const refusals = {
  url: "that isn't a URL",
  scheme: 'seven opens only http and https URLs',
  own: "seven doesn't open its own pages or the vault for a program",
  dismissed: 'the request to open the page was dismissed',
  timeout: 'nobody answered the request to open the page within 60 s',
};
const hint =
  "open: if seven asked, answer in seven's tab (a click allows it), then run open again\n";
const page = { calls: [], fail: undefined, hold: undefined };

function refusal(name, message) {
  return Object.assign(new Error(message), { name });
}

async function drain(body) {
  const chunks = [];
  if (body) for await (const chunk of body) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

const requests = {
  kinds: { 'open.url': {}, 'open.file': {}, 'open.download': {}, 'open.reveal': {} },
  async handle(request) {
    const body = await drain(request.body);
    page.calls.push({ kind: request.kind, options: request.options, body: body.toString() });
    if (page.fail) throw page.fail;
    if (request.kind === 'open.url') {
      const reason = /^https?:/.test(request.options.url) ? undefined : refusals.scheme;
      if (reason) throw refusal('NotAllowedError', reason);
      return '';
    }
    if (request.kind === 'open.reveal') {
      throw refusal('NotSupportedError', 'this embedder does not answer open.reveal');
    }
    if (request.kind === 'open.file') return `blob:https://sandbox.example/${page.calls.length}\n`;
    return '';
  },
};

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const JPEG = Buffer.from('ffd8ffe000104a464946', 'hex');
const GIF = Buffer.from('GIF89a\x01\x00\x01\x00', 'latin1');
const WEBP = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.from([4, 0, 0, 0]),
  Buffer.from('WEBPVP8 '),
]);
const curl = `#!/bin/sh
case $3 in
  *missing*) printf partial; echo 'curl: (22) The requested URL returned error: 404' >&2; exit 22 ;;
esac
printf 'fetched %s|%s|%s' "$1" "$2" "$3"
`;

let os;

before(async () => {
  os = await boot({ requests });
  await os.kernel.writeFile('/tmp/fake/curl', curl);
  await os.sh('chmod +x /tmp/fake/curl');
});

after(() => os?.close());

beforeEach(() => {
  page.calls = [];
  page.fail = undefined;
});

const run = (argv, opts) => os.run(argv, opts);
const calls = () => page.calls.map(({ kind, options, body }) => ({ kind, options, body }));

describe('in a kernel with a page', () => {
  it('installs open, xdg-open and scopen in /usr/bin', async () => {
    const result = await os.sh('command -v open xdg-open scopen');
    assert.equal(result.stdout, '/usr/bin/open\n/usr/bin/xdg-open\n/usr/bin/scopen\n');
  });

  it('opens a URL with open.url over O_WRONLY, and -g as background', async () => {
    assert.deepEqual(await run(['open', 'https://example.com/a?b=1']), {
      status: 0,
      stdout: 'opened https://example.com/a?b=1\n',
      stderr: '',
    });
    assert.deepEqual(await run(['scopen', '-g', '-n', '-u', 'https://example.com/u']), {
      status: 0,
      stdout: 'opened https://example.com/u\n',
      stderr: '',
    });
    assert.deepEqual(await run(['xdg-open', 'http://example.com/x']), {
      status: 0,
      stdout: 'opened http://example.com/x\n',
      stderr: '',
    });
    assert.deepEqual(calls(), [
      { kind: 'open.url', options: { url: 'https://example.com/a?b=1' }, body: '' },
      {
        kind: 'open.url',
        options: { url: 'https://example.com/u', background: true },
        body: '',
      },
      { kind: 'open.url', options: { url: 'http://example.com/x' }, body: '' },
    ]);
  });

  it('escapes a hostile URL and path into the JSON header, and never runs them', async () => {
    const url = 'https://e.example/"q"\\$(touch /tmp/pwned)`id`\n\t\x01\x1f\x7fé😀';
    const result = await run(['open', url]);
    assert.equal(result.status, 0, result.stderr);
    const name = 'h"q\\$(touch pwned)\n\té😀.html';
    await os.kernel.writeFile(`/tmp/${name}`, 'body $(id)');
    const file = await run(['open', name]);
    assert.equal(file.status, 0, file.stderr);
    assert.equal(file.stdout, `opened /tmp/${name} → blob:https://sandbox.example/2\n`);
    assert.deepEqual(calls(), [
      { kind: 'open.url', options: { url }, body: '' },
      { kind: 'open.file', options: { name, type: 'text/html' }, body: 'body $(id)' },
    ]);
    assert.equal((await os.sh('test -e /tmp/pwned || test -e pwned')).status, 1);
  });

  it('sends a file as the body of open.file, with its type, and prints the URL', async () => {
    await os.sh("mkdir -p /w/site/src && printf '<p>hi</p>' > /w/site/src/index.html");
    await os.sh('printf x > /w/site/notes.TXT && printf y > /w/site/raw && printf z > /w/site/.rc');
    const result = await run(['open', 'src/index.html', '../site/notes.TXT', 'raw', '.rc'], {
      cwd: '/w/site',
    });
    assert.deepEqual(result, {
      status: 0,
      stdout:
        'opened /w/site/src/index.html → blob:https://sandbox.example/1\n' +
        'opened /w/site/notes.TXT → blob:https://sandbox.example/2\n' +
        'opened /w/site/raw → blob:https://sandbox.example/3\n' +
        'opened /w/site/.rc → blob:https://sandbox.example/4\n',
      stderr: '',
    });
    assert.deepEqual(calls(), [
      { kind: 'open.file', options: { name: 'index.html', type: 'text/html' }, body: '<p>hi</p>' },
      { kind: 'open.file', options: { name: 'notes.TXT', type: 'text/plain' }, body: 'x' },
      { kind: 'open.file', options: { name: 'raw' }, body: 'y' },
      { kind: 'open.file', options: { name: '.rc' }, body: 'z' },
    ]);
  });

  it('resolves a plain relative file against the working directory, and takes absolute paths as they are', async () => {
    await os.sh('mkdir -p /w/a/b && printf 1 > /w/a/b/f.css && printf 2 > /w/a/f.css');
    const result = await os.sh('cd /w/a/b && open f.css && open /w/a/f.css && xdg-open ./f.css');
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(
      result.stdout.split('\n').map((line) => line.split(' → ')[0]),
      ['opened /w/a/b/f.css', 'opened /w/a/f.css', 'opened /w/a/b/f.css', '']
    );
    assert.deepEqual(
      calls().map((call) => call.body),
      ['1', '2', '1']
    );
  });

  it('opens a file named like an option after --, and - as a file', async () => {
    await os.sh("printf a > /tmp/-e && printf b > '/tmp/-'");
    const result = await run(['open', '--', '-e', '-']);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(
      calls().map((call) => [call.options.name, call.body]),
      [
        ['-e', 'a'],
        ['-', 'b'],
      ]
    );
  });

  it('serves -e and -t as text/plain, and saves -f stdin to /tmp/open-<random>.txt', async () => {
    await os.sh('printf "<b>" > /tmp/page.html');
    for (const flag of ['-e', '-t']) {
      assert.equal((await run(['open', flag, 'page.html'])).status, 0);
    }
    const piped = await os.sh("printf 'from stdin' | scopen -f");
    assert.equal(piped.status, 0, piped.stderr);
    assert.match(piped.stdout, /^opened \/tmp\/open-[A-Za-z0-9]{8}\.txt → blob:/);
    const saved = piped.stdout.split(' ')[1];
    assert.equal((await os.sh(`cat ${saved}`)).stdout, 'from stdin');
    assert.deepEqual(calls(), [
      { kind: 'open.file', options: { name: 'page.html', type: 'text/plain' }, body: '<b>' },
      { kind: 'open.file', options: { name: 'page.html', type: 'text/plain' }, body: '<b>' },
      {
        kind: 'open.file',
        options: { name: saved.slice(5), type: 'text/plain' },
        body: 'from stdin',
      },
    ]);
  });

  it('downloads a file, and an http URL fetched with curl, as open.download with the bytes', async () => {
    await os.sh('printf PDF > /tmp/report.pdf');
    const file = await run(['open', '--download', 'report.pdf']);
    assert.deepEqual(file, { status: 0, stdout: 'downloaded /tmp/report.pdf\n', stderr: '' });
    const url = 'https://a.example/x/Pic.PNG?q=1#f';
    const fetched = await os.sh(`PATH=/tmp/fake:$PATH open -d '${url}' https://a.example`);
    assert.deepEqual(fetched, {
      status: 0,
      stdout: `downloaded ${url}\ndownloaded https://a.example\n`,
      stderr: '',
    });
    assert.deepEqual(calls(), [
      {
        kind: 'open.download',
        options: { name: 'report.pdf', type: 'application/pdf' },
        body: 'PDF',
      },
      {
        kind: 'open.download',
        options: { name: 'Pic.PNG', type: 'image/png' },
        body: `fetched -fsSL|--|${url}`,
      },
      {
        kind: 'open.download',
        options: { name: 'download' },
        body: 'fetched -fsSL|--|https://a.example',
      },
    ]);
  });

  it("fails -d with a URL when curl fails or isn't on PATH, before anything is sent", async () => {
    const failed = await os.sh('PATH=/tmp/fake:$PATH open -d https://a.example/missing.zip');
    assert.deepEqual(failed, {
      status: 1,
      stdout: '',
      stderr:
        'open: https://a.example/missing.zip: curl: (22) The requested URL returned error: 404\n',
    });
    const none = await run(['open', '-d', 'https://a.example/x.zip']);
    assert.deepEqual(none, {
      status: 1,
      stdout: '',
      stderr: 'open: -d with a URL needs curl on PATH\n',
    });
    assert.deepEqual(calls(), []);
    const left = (await os.sh('ls /tmp')).stdout.split('\n');
    assert.deepEqual(
      left.filter((name) => /^open-[A-Za-z0-9]+$/.test(name)),
      []
    );
  });

  it('downloads a -u URL under -d, from a fetch that finished first', async () => {
    const result = await os.sh('PATH=/tmp/fake:$PATH open -d -u https://a.example/r.pdf');
    assert.deepEqual(result, {
      status: 0,
      stdout: 'downloaded https://a.example/r.pdf\n',
      stderr: '',
    });
    assert.deepEqual(calls(), [
      {
        kind: 'open.download',
        options: { name: 'r.pdf', type: 'application/pdf' },
        body: 'fetched -fsSL|--|https://a.example/r.pdf',
      },
    ]);
  });

  it('asks open.reveal for -R with the absolute path, a directory too, and reports ENOTSUP', async () => {
    await os.sh('mkdir -p /tmp/shown.d');
    assert.deepEqual(await run(['open', '-R', 'shown.d']), {
      status: 1,
      stdout: '',
      stderr: 'open: /tmp/shown.d: this embedder does not answer open.reveal\n',
    });
    assert.deepEqual(await run(['open', '-R', 'gone.d']), {
      status: 1,
      stdout: '',
      stderr: 'open: gone.d: No such file or directory\n',
    });
    page.calls = [];
    await os.sh('printf r > /tmp/shown.txt');
    assert.deepEqual(await run(['open', '-R', 'shown.txt']), {
      status: 1,
      stdout: '',
      stderr: 'open: /tmp/shown.txt: this embedder does not answer open.reveal\n',
    });
    assert.deepEqual(calls(), [
      { kind: 'open.reveal', options: { path: '/tmp/shown.txt' }, body: '' },
    ]);
  });

  it("prints the page's refusals as they are, with what to do for EACCES, and exits 1", async () => {
    assert.deepEqual(await run(['open', 'mailto:a@example.com']), {
      status: 1,
      stdout: '',
      stderr: `open: mailto:a@example.com: ${refusals.scheme}\n${hint}`,
    });
    for (const reason of Object.values(refusals)) {
      page.fail = refusal('NotAllowedError', reason);
      assert.deepEqual(await run(['open', 'https://example.com']), {
        status: 1,
        stdout: '',
        stderr: `open: https://example.com: ${reason}\n${hint}`,
      });
    }
  });

  it('maps ENOTSUP, ENOENT and EIO to one line each, exit 1, and stops at the first failure', async () => {
    await os.sh('printf 1 > /tmp/one.txt');
    for (const [name, message] of [
      ['NotSupportedError', 'this embedder does not answer open.file'],
      ['NotFoundError', 'the file is gone'],
      ['TypeError', 'the service worker failed'],
    ]) {
      page.calls = [];
      page.fail = refusal(name, `${message}\nsecond line`);
      assert.deepEqual(await run(['open', 'one.txt', 'https://example.com']), {
        status: 1,
        stdout: '',
        stderr: `open: /tmp/one.txt: ${message}\n`,
      });
      assert.equal(page.calls.length, 1);
    }
  });

  it('checks every file before anything is opened, with the messages of coreutils', async () => {
    const missing = await run(['open', 'https://example.com', 'nope.txt']);
    assert.deepEqual(missing, {
      status: 1,
      stdout: '',
      stderr: 'open: nope.txt: No such file or directory\n',
    });
    assert.deepEqual(await run(['xdg-open', '/tmp']), {
      status: 1,
      stdout: '',
      stderr: 'xdg-open: /tmp: Is a directory\n',
    });
    assert.equal(page.calls.length, 0);
  });

  it('prints an <img:PATH> line per image for -v, by magic bytes, without the page', async () => {
    await os.kernel.writeFile('/tmp/img/a.png', PNG);
    await os.kernel.writeFile('/tmp/img/b.jpg', JPEG);
    await os.kernel.writeFile('/tmp/img/c.gif', GIF);
    await os.kernel.writeFile('/tmp/img/d', WEBP);
    await os.sh('ln -s /tmp/img/a.png /tmp/img/link.png && printf text > /tmp/img/e.png');
    const result = await run(
      ['open', '--view', 'a.png', './b.jpg', '../img/c.gif', 'd', 'link.png'],
      {
        cwd: '/tmp/img',
      }
    );
    assert.deepEqual(result, {
      status: 0,
      stdout:
        '<img:/tmp/img/a.png>\n<img:/tmp/img/b.jpg>\n<img:/tmp/img/c.gif>\n<img:/tmp/img/d>\n<img:/tmp/img/a.png>\n',
      stderr: '',
    });
    assert.deepEqual(await run(['scopen', '-v', 'a.png', 'e.png'], { cwd: '/tmp/img' }), {
      status: 1,
      stdout: '',
      stderr: 'scopen: e.png: not a PNG, JPEG, GIF or WebP image\n',
    });
    assert.deepEqual(await run(['open', '-v', 'gone.png'], { cwd: '/tmp/img' }), {
      status: 1,
      stdout: '',
      stderr: 'open: gone.png: No such file or directory\n',
    });
    await os.kernel.writeFile('/tmp/img/n\nl.png', PNG);
    assert.deepEqual(await run(['open', '-v', 'n\nl.png'], { cwd: '/tmp/img' }), {
      status: 1,
      stdout: '',
      stderr: "open: n\nl.png: a path with a newline can't be shown inline\n",
    });
    assert.equal(page.calls.length, 0);
  });

  it('refuses unsupported options with exit 2 and the usage, before anything is opened', async () => {
    for (const [argv, message] of [
      [['-a', 'Safari', 'x'], '-a is not supported in SLICC'],
      [['-bcom.apple', 'x'], '-b is not supported in SLICC'],
      [['-F', 'x'], '-F is not supported in SLICC'],
      [['-W', 'x'], '-W is not supported in SLICC'],
      [['-j', 'x'], '-j is not supported in SLICC'],
      [['-s', '14', 'x'], '-s is not supported in SLICC'],
      [['--env', 'A=1', 'x'], '--env is not supported in SLICC'],
      [['--stdin=/x', 'x'], '--stdin is not supported in SLICC'],
      [['--stdout', '/x', 'x'], '--stdout is not supported in SLICC'],
      [['--stderr', '/x', 'x'], '--stderr is not supported in SLICC'],
      [['--arch', 'arm64', 'x'], '--arch is not supported in SLICC'],
      [['-v', '--size', 'low', 'x'], '--size is not supported in SLICC'],
      [['x', '--args', 'a'], undefined],
      [['--args', 'a'], '--args is not supported in SLICC'],
      [['-Z', 'x'], 'unknown option -Z'],
      [['--nope', 'x'], 'unknown option --nope'],
      [['--download=x', 'x'], '--download takes no value'],
      [['-u'], '-u needs a value'],
      [['--size'], '--size needs a value'],
      [['-u', 'nope'], '-u needs a URL, not nope'],
      [['-e', '-t', '-v', 'x'], "-e and -t and -v can't be given together"],
      [['-dR', 'x'], "-d and -R can't be given together"],
      [['-f', 'x'], '-f takes no targets'],
      [['-f', '-u', 'https://a.example'], '-f takes no targets'],
      [['-g'], 'no target'],
      [['-R', 'https://a.example'], '-R takes paths, not URLs'],
      [['-v', 'https://a.example/a.png'], '-v takes paths, not URLs'],
      [['-t', '-u', 'https://a.example'], '-t takes paths, not URLs'],
      [['-d', 'ftp://a.example/x'], '-d takes paths and http or https URLs, not ftp://a.example/x'],
      [['--version', 'x'], '--version takes no other arguments'],
      [['--upgrade', '--version'], '--version takes no other arguments'],
      [['--upgrade', 'x'], '--upgrade takes no other arguments'],
    ]) {
      const result = await run(['open', ...argv]);
      if (message === undefined) {
        assert.equal(result.status, 1, argv.join(' '));
        continue;
      }
      assert.deepEqual(
        result,
        { status: 2, stdout: '', stderr: `open: ${message}\n${usage}` },
        argv.join(' ')
      );
    }
    assert.deepEqual(await run(['xdg-open', '-e', 'x']), {
      status: 2,
      stdout: '',
      stderr: 'xdg-open: unknown option -e\nusage: xdg-open {FILE | URL}\n',
    });
    assert.deepEqual(await run(['xdg-open', 'a', 'b']), {
      status: 2,
      stdout: '',
      stderr: 'xdg-open: more than one target\nusage: xdg-open {FILE | URL}\n',
    });
    assert.deepEqual(await run(['xdg-open']), {
      status: 2,
      stdout: '',
      stderr: 'xdg-open: no target\nusage: xdg-open {FILE | URL}\n',
    });
    assert.deepEqual(await run(['xdg-open', '--version', 'x']), {
      status: 2,
      stdout: '',
      stderr: 'xdg-open: --version takes no other arguments\nusage: xdg-open {FILE | URL}\n',
    });
    assert.deepEqual(await run(['open']), { status: 2, stdout: '', stderr: usage });
    assert.deepEqual(await run(['scopen']), {
      status: 2,
      stdout: '',
      stderr: usage.replace('open', 'scopen'),
    });
    assert.equal(page.calls.length, 0);
  });

  it('answers -h, --help, --manual, --version and --upgrade without the page', async () => {
    for (const argv of [
      ['open', '-h'],
      ['open', '-Z', '--help', 'x'],
      ['scopen', '-gh'],
    ]) {
      const result = await run(argv);
      assert.equal(result.status, 0, argv.join(' '));
      assert.equal(result.stderr, '');
      assert.ok(result.stdout.startsWith(`usage: ${argv[0]} [-e`), result.stdout);
      assert.match(result.stdout, /\n {2}-v, --view {6}print <img:PATH>/);
    }
    const xdg = await run(['xdg-open', '-x', '--help']);
    assert.equal(xdg.status, 0);
    assert.ok(xdg.stdout.startsWith('usage: xdg-open {FILE | URL}\n  FILE | URL'));
    assert.doesNotMatch(xdg.stdout, /^exit status/m);
    const manual = await run(['xdg-open', '--manual']);
    assert.equal(manual.status, 0);
    assert.ok(manual.stdout.startsWith(xdg.stdout));
    assert.match(
      manual.stdout,
      /\nexit status: 0 when everything opened, 1 when a target or the page failed, 2 for a usage error\n$/
    );
    for (const name of ['open', 'xdg-open', 'scopen']) {
      assert.deepEqual(await run([name, '--version']), {
        status: 0,
        stdout: `${version}\n`,
        stderr: '',
      });
      assert.deepEqual(await run([name, '--upgrade']), {
        status: 0,
        stdout: 'pnpm add -g @ai-ecoverse/slicc-open@latest\n',
        stderr: '',
      });
    }
    assert.equal(page.calls.length, 0);
  });

  it('reads a file as the session user: EACCES from coreutils, and the page sees the bytes', async () => {
    const strict = await boot({ requests, users: 'enforce' });
    try {
      await strict.kernel.users.add({ name: 'bob' });
      await strict.sh(
        'printf s > /tmp/secret && chmod 600 /tmp/secret && printf o > /tmp/open.txt && chmod 644 /tmp/open.txt'
      );
      const denied = await strict.run(['open', '/tmp/secret'], { user: 'bob' });
      assert.deepEqual(denied, {
        status: 1,
        stdout: '',
        stderr: 'open: /tmp/secret: Permission denied\n',
      });
      const allowed = await strict.run(['open', '/tmp/open.txt'], { user: 'bob' });
      assert.equal(allowed.status, 0, allowed.stderr);
      assert.deepEqual(calls(), [
        { kind: 'open.file', options: { name: 'open.txt', type: 'text/plain' }, body: 'o' },
      ]);
    } finally {
      strict.close();
    }
  });
});

describe('without a page', () => {
  it('gets ENOTSUP from a session no page answers', async () => {
    const bare = await boot();
    try {
      assert.deepEqual(await bare.run(['open', 'https://example.com']), {
        status: 1,
        stdout: '',
        stderr: 'open: https://example.com: no page answers requests for this session\n',
      });
      assert.equal((await bare.run(['open', '--version'])).status, 0);
    } finally {
      bare.close();
    }
  });

  it('is refused by a kernel older than 1.153.0, and without /dev/embedder says what it needs', async () => {
    const old = await bootOld(true);
    try {
      const refused = await old.run(['open', 'https://example.com']);
      assert.notEqual(refused.status, 0);
      assert.match(refused.stderr, /needs slicc-kernel >=1\.153\.0/);
    } finally {
      old.close();
    }
    const bare = await bootOld(false);
    try {
      await bare.sh('printf x > /tmp/f.txt');
      for (const name of ['open', 'xdg-open', 'scopen']) {
        assert.deepEqual(await bare.run([name, 'f.txt']), {
          status: 1,
          stdout: '',
          stderr: `${name}: /dev/embedder not available (needs slicc-kernel >= 1.153.0)\n`,
        });
      }
      assert.deepEqual(await bare.run(['open', 'nope.txt']), {
        status: 1,
        stdout: '',
        stderr: 'open: /dev/embedder not available (needs slicc-kernel >= 1.153.0)\n',
      });
      assert.equal((await bare.run(['open', '-h'])).status, 0);
      assert.equal((await bare.run(['open', '-Z', 'x'])).status, 2);
    } finally {
      bare.close();
    }
  });
});
