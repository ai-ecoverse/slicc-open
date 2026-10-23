import { closeSync, mkdtempSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fail, say } from './io.mjs';
import { help, parse, usage } from './options.mjs';
import { check, environment, resolveTargets, settings } from './plan.mjs';
import { detach, first, lookup, wait } from './spawn.mjs';
import { upgrade, version } from './upgrade.mjs';
import { windowsCommandLine, windowsScript } from './windows.mjs';

function stdinFile(ctx) {
  const text = readFileSync(ctx.fds[0]);
  const path = join(mkdtempSync(join(tmpdir(), 'scopen-')), 'stdin.txt');
  writeFileSync(path, text);
  return path;
}

async function step(ctx, tool, args, extra = {}) {
  const options = { env: ctx.env, cwd: ctx.cwd, hidden: ctx.hidden, ...extra };
  if (extra.detached) {
    const result = await detach(tool.path, args, options);
    return result.error ? fail(ctx, `${tool.file}: ${result.error.message}`) : 0;
  }
  const result = await wait(tool.path, args, {
    stdio: [ctx.stdin ? ctx.fds[0] : 'ignore', 'ignore', 'pipe'],
    ...options,
  });
  if (result.error) return fail(ctx, `${tool.file}: ${result.error.message}`);
  if (result.code === 0 || extra.ignoreStatus) return 0;
  if (result.stderr.length > 0) say(ctx.fds[2], result.stderr);
  else fail(ctx, `${tool.file} exited with status ${result.code}`);
  return 1;
}

function opener(ctx, files) {
  const tool = first(files, ctx.platform, ctx.env, ctx.cwd);
  if (!tool) fail(ctx, `no opener found (tried ${files.join(', ')})`);
  return tool;
}

async function each(ctx, values, run) {
  for (const value of values) {
    const code = await run(value);
    if (code !== 0) return code;
  }
  return 0;
}

async function macos(ctx, parsed, targets) {
  const tool = opener(ctx, ['open']);
  if (!tool) return 1;
  const args = [];
  for (const option of parsed.options) {
    args.push(option.name);
    if (option.value !== undefined) args.push(option.value);
  }
  args.push(...targets.map((target) => target.value));
  if (parsed.args !== undefined) args.push('--args', ...parsed.args);
  const stdin = parsed.options.some((option) => option.name === '-f');
  return step({ ...ctx, stdin }, tool, args);
}

function redirects(ctx, redirect, wait) {
  const fds = [];
  const stdio = [];
  const flags = { stdin: 'r', stdout: 'w', stderr: 'w' };
  for (const [index, name] of ['stdin', 'stdout', 'stderr'].entries()) {
    const path = redirect[name];
    if (path === undefined) {
      stdio.push(wait ? ctx.fds[index] : 'ignore');
      continue;
    }
    try {
      const fd = openSync(path, flags[name]);
      fds.push(fd);
      stdio.push(fd);
    } catch (error) {
      for (const fd of fds) closeSync(fd);
      return {
        error: `${path}: ${error.code === 'ENOENT' ? 'No such file or directory' : error.message}`,
      };
    }
  }
  return { fds, stdio };
}

async function linuxApp(ctx, plan, values) {
  const tool = lookup(plan.app, ctx.platform, ctx.env, ctx.cwd);
  if (!tool) return fail(ctx, `${plan.app}: command not found`);
  const io = redirects(ctx, plan.redirect, plan.wait);
  if (io.error) return fail(ctx, io.error);
  const app = { file: plan.app, path: tool };
  const args = [...values, ...plan.args];
  try {
    if (!plan.wait) return await step(ctx, app, args, { detached: true, stdio: io.stdio });
    const result = await wait(tool, args, {
      env: ctx.env,
      cwd: ctx.cwd,
      stdio: io.stdio,
      hidden: false,
    });
    if (result.error) return fail(ctx, `${plan.app}: ${result.error.message}`);
    return result.code === 0 ? 0 : 1;
  } finally {
    for (const fd of io.fds) closeSync(fd);
  }
}

async function linux(ctx, plan, values) {
  if (plan.app !== undefined) return linuxApp(ctx, plan, values);
  const tool = opener(ctx, ['xdg-open', 'gio']);
  if (!tool) return 1;
  const shown = plan.reveal ? values.map((value) => dirname(value)) : values;
  return each(ctx, shown, (value) =>
    step(ctx, tool, tool.file === 'gio' ? ['open', value] : [value])
  );
}

function item(plan, file, list) {
  const out = { FilePath: file };
  const line = windowsCommandLine(list);
  if (line !== '') out.ArgumentList = line;
  if (plan.wait) out.Wait = true;
  if (plan.hidden) out.WindowStyle = 'Hidden';
  if (plan.redirect.stdin) out.RedirectStandardInput = plan.redirect.stdin;
  if (plan.redirect.stdout) out.RedirectStandardOutput = plan.redirect.stdout;
  if (plan.redirect.stderr) out.RedirectStandardError = plan.redirect.stderr;
  return out;
}

async function windowsDirect(ctx, plan, file, values, make) {
  const tool = opener(ctx, [file]);
  if (!tool) return 1;
  const extra = file === 'explorer.exe' ? { ignoreStatus: true } : {};
  return each(ctx, values, (value) =>
    plan.wait || file === 'explorer.exe'
      ? step(ctx, tool, make(value), extra)
      : step(ctx, tool, make(value), { detached: true, stdio: 'ignore' })
  );
}

async function windows(ctx, plan, values) {
  if (plan.reveal) {
    return windowsDirect(ctx, plan, 'explorer.exe', values, (value) => [`/select,${value}`]);
  }
  if (plan.app === undefined && (plan.text || plan.file)) {
    return windowsDirect(ctx, plan, 'notepad.exe', values, (value) => [value]);
  }
  const tool = opener(ctx, ['powershell.exe', 'pwsh.exe']);
  if (!tool) return 1;
  const items =
    plan.app === undefined
      ? values.map((value) => item(plan, value, []))
      : [item(plan, plan.app, [...values, ...plan.args])];
  const env = { ...ctx.env, SCOPEN_ARGV: JSON.stringify(items) };
  return step({ ...ctx, env }, tool, ['-NoProfile', '-NonInteractive', '-Command', windowsScript]);
}

async function open(ctx, parsed) {
  const resolved = resolveTargets(parsed, ctx.cwd);
  if (resolved.error) return fail(ctx, resolved.error);
  if (ctx.platform === 'darwin') {
    const env = { ...ctx.env };
    delete env.SCOPEN_INSTALL_DIR;
    return macos({ ...ctx, env }, parsed, resolved.targets);
  }
  const plan = settings(parsed, ctx.cwd);
  const values = [...plan.urls, ...resolved.targets.map((target) => target.value)];
  if (plan.stdin) {
    values.push(stdinFile(ctx));
    plan.file = true;
  }
  const local = { ...ctx, env: environment(parsed, ctx.env), hidden: plan.hidden };
  if (ctx.platform === 'win32') return windows(local, plan, values);
  return linux(local, plan, values);
}

function usageError(ctx, text) {
  say(ctx.fds[2], `scopen: ${text}\n${usage}\n`);
  return 2;
}

export async function run({
  argv = process.argv.slice(2),
  env = process.env,
  platform = process.platform,
  cwd = process.cwd(),
  fds = [0, 1, 2],
  timeout = 60000,
} = {}) {
  const ctx = { env, platform, cwd, fds, timeout, hidden: false };
  if (argv.length === 0) {
    say(fds[2], `${usage}\n`);
    return 2;
  }
  const parsed = parse(argv);
  const names = parsed.options.map((option) => option.name);
  if (names.includes('-h')) {
    say(fds[1], help);
    return 0;
  }
  if (parsed.error) return usageError(ctx, parsed.error);
  for (const name of ['--version', '--upgrade']) {
    if (!names.includes(name)) continue;
    if (argv.length > 1) return usageError(ctx, `${name} takes no other arguments`);
    if (name === '--upgrade') return upgrade(ctx);
    say(fds[1], `${version()}\n`);
    return 0;
  }
  const problem = check(parsed, platform);
  if (problem) return usageError(ctx, problem);
  return open(ctx, parsed);
}
