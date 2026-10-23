import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fail, say } from './io.mjs';
import { first, wait } from './spawn.mjs';

const latest = 'https://github.com/ai-ecoverse/slicc-open/releases/latest/download';

export function version() {
  return JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
}

async function download(url, timeout) {
  try {
    const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(timeout) });
    if (!response.ok) return { error: `could not download ${url}: HTTP ${response.status}` };
    return { text: await response.text() };
  } catch (error) {
    if (error.name === 'TimeoutError') return { error: 'download timed out' };
    return { error: `could not download ${url}: ${error.cause?.message ?? error.message}` };
  }
}

function installer(ctx, path, dir) {
  if (ctx.platform === 'win32') {
    const tool = first(['powershell.exe', 'pwsh.exe'], ctx.platform, ctx.env, ctx.cwd);
    const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path];
    return tool && { tool, args: [...args, '-Dir', dir] };
  }
  const tool = first(['sh'], ctx.platform, ctx.env, ctx.cwd);
  return tool && { tool, args: [path, '--dir', dir] };
}

export async function upgrade(ctx) {
  const dir = ctx.env.SCOPEN_INSTALL_DIR;
  if (!dir) {
    say(ctx.fds[1], 'npm install -g @ai-ecoverse/slicc-open@latest\n');
    return 0;
  }
  const name = ctx.platform === 'win32' ? 'install.ps1' : 'install.sh';
  const url = `${(ctx.env.SLICC_INSTALL_BASE_URL || latest).replace(/\/+$/, '')}/${name}`;
  const fetched = await download(url, ctx.timeout ?? 60000);
  if (fetched.error) return fail(ctx, fetched.error);
  const scratch = mkdtempSync(join(tmpdir(), 'scopen-upgrade-'));
  try {
    const path = join(scratch, name);
    writeFileSync(path, fetched.text);
    const run = installer(ctx, path, dir);
    if (!run) {
      const tried = ctx.platform === 'win32' ? 'powershell.exe, pwsh.exe' : 'sh';
      return fail(ctx, `no shell found to run ${name} (tried ${tried})`);
    }
    const env = { ...ctx.env };
    delete env.SCOPEN_INSTALL_DIR;
    if (ctx.platform === 'win32') {
      for (const key of Object.keys(env)) {
        if (key.toUpperCase() === 'PSMODULEPATH') delete env[key];
      }
    }
    const result = await wait(run.tool.path, run.args, {
      env,
      cwd: ctx.cwd,
      stdio: ['ignore', 'pipe', ctx.fds[2]],
      hidden: true,
    });
    if (result.error) return fail(ctx, `${run.tool.file}: ${result.error.message}`);
    if (result.code !== 0) return 1;
    const installed = /^scopen (\S+) installed to /m.exec(result.stdout.toString())?.[1];
    if (!installed) return fail(ctx, `${name} did not say which version it installed`);
    const old = version();
    say(
      ctx.fds[1],
      installed === old
        ? `scopen: already up to date (${old})\n`
        : `scopen: ${old} → ${installed}\n`
    );
    return 0;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
