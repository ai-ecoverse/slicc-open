import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { isUrl } from './options.mjs';

export function platformName(platform) {
  if (platform === 'darwin') return 'macOS';
  if (platform === 'win32') return 'Windows';
  return 'Linux';
}

const everywhere = ['-s', '-d', '-v', '--size'];
const unsupported = {
  macOS: everywhere,
  Linux: [...everywhere, '-b', '-e', '-t', '-F', '-g', '-j', '--arch'],
  Windows: [...everywhere, '-b', '-F', '-g', '--arch'],
};
const needApp = {
  macOS: [],
  Linux: ['-W', '-n', '--stdin', '--stdout', '--stderr'],
  Windows: ['-n', '--stdin', '--stdout', '--stderr'],
};

function last(options, name) {
  return options.findLast((option) => option.name === name)?.value;
}

function has(options, name) {
  return options.some((option) => option.name === name);
}

function support(parsed, where) {
  const app = has(parsed.options, '-a');
  for (const option of parsed.options) {
    if (unsupported[where].includes(option.name)) {
      return `${option.shown} is not supported on ${where}`;
    }
    if (!app && needApp[where].includes(option.name)) {
      return `${option.shown} without -a is not supported on ${where}`;
    }
  }
  if (!app && parsed.args !== undefined && where !== 'macOS') {
    return `--args without -a is not supported on ${where}`;
  }
  return undefined;
}

function combine(parsed, where) {
  const { options, targets } = parsed;
  const modes = ['-e', '-t', '-f'].filter((name) => has(options, name));
  if (modes.length > 1) return `${modes.join(' and ')} can't be given together`;
  const notUrl = options.find((option) => option.name === '-u' && !isUrl(option.value));
  if (notUrl) return `-u needs a URL, not ${notUrl.value}`;
  if (has(options, '-f') && (targets.length > 0 || has(options, '-u'))) {
    return '-f takes no targets';
  }
  const given = ['-a', '-b', '-u', '-f'].some((name) => has(options, name));
  if (!given && targets.length === 0) return 'no target';
  if (where === 'macOS') return undefined;
  if (has(options, '-R')) {
    const other = ['-a', '-e', '-t', '-f'].find((name) => has(options, name));
    if (other) return `-R and ${other} can't be given together`;
    const url = [...targets.filter(isUrl), ...options.filter((option) => option.name === '-u')];
    if (url.length > 0) return '-R takes paths, not URLs';
  }
  const editor = modes.find((name) => name !== '-f');
  if (has(options, '-a') && editor) return `-a and ${editor} can't be given together`;
  for (const option of options) {
    if (option.name === '--env' && !/^[A-Za-z_][A-Za-z0-9_]*(=[\s\S]*)?$/.test(option.value)) {
      return `--env needs NAME or NAME=VALUE, not ${option.value}`;
    }
  }
  return undefined;
}

export function check(parsed, platform) {
  const where = platformName(platform);
  return support(parsed, where) ?? combine(parsed, where);
}

export function resolveTargets(parsed, cwd) {
  const targets = [];
  for (const target of parsed.targets) {
    if (isUrl(target)) {
      targets.push({ value: target, url: true });
      continue;
    }
    const path = resolve(cwd, target);
    if (!existsSync(path)) return { error: `${target}: No such file or directory` };
    targets.push({ value: path, url: false });
  }
  return { targets };
}

export function environment(parsed, env) {
  const out = { ...env };
  delete out.SCOPEN_INSTALL_DIR;
  for (const option of parsed.options) {
    if (option.name !== '--env') continue;
    const at = option.value.indexOf('=');
    if (at === -1) continue;
    out[option.value.slice(0, at)] = option.value.slice(at + 1);
  }
  return out;
}

export function settings(parsed, cwd) {
  const { options } = parsed;
  const file = (name) => {
    const value = last(options, name);
    return value === undefined ? undefined : resolve(cwd, value);
  };
  return {
    app: last(options, '-a'),
    wait: has(options, '-W'),
    reveal: has(options, '-R'),
    text: has(options, '-e') || has(options, '-t'),
    stdin: has(options, '-f'),
    hidden: has(options, '-j'),
    urls: options.filter((option) => option.name === '-u').map((option) => option.value),
    redirect: { stdin: file('--stdin'), stdout: file('--stdout'), stderr: file('--stderr') },
    args: parsed.args ?? [],
  };
}
