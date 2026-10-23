import { spawn } from 'node:child_process';
import { accessSync, constants, statSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

function runnable(path, platform) {
  try {
    if (!statSync(path).isFile()) return false;
    accessSync(path, platform === 'win32' ? constants.F_OK : constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function lookup(file, platform, env, cwd) {
  if (file.includes('/') || (platform === 'win32' && file.includes('\\'))) {
    const path = isAbsolute(file) ? file : resolve(cwd, file);
    return runnable(path, platform) ? path : undefined;
  }
  const list = (platform === 'win32' ? (env.PATH ?? env.Path) : env.PATH) ?? '';
  for (const dir of list.split(platform === 'win32' ? ';' : ':')) {
    if (dir && runnable(join(dir, file), platform)) return join(dir, file);
  }
  return undefined;
}

export function first(files, platform, env, cwd) {
  for (const file of files) {
    const path = lookup(file, platform, env, cwd);
    if (path) return { file, path };
  }
  return undefined;
}

export function detach(path, args, { env, cwd, stdio, hidden }) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(path, args, {
        env,
        cwd,
        stdio,
        detached: true,
        shell: false,
        windowsHide: hidden,
      });
    } catch (error) {
      resolve({ error });
      return;
    }
    child.on('error', (error) => resolve({ error }));
    child.on('spawn', () => {
      child.unref();
      resolve({ code: 0 });
    });
  });
}

export function wait(path, args, { env, cwd, stdio, hidden }) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(path, args, { env, cwd, stdio, shell: false, windowsHide: hidden });
    } catch (error) {
      resolve({ error });
      return;
    }
    const chunks = [];
    let code;
    let timer;
    const done = () => {
      clearTimeout(timer);
      child.stdout?.destroy();
      child.stderr?.destroy();
      resolve({
        code,
        stdout: Buffer.concat(chunks.filter((chunk) => chunk.out).map((chunk) => chunk.data)),
        stderr: Buffer.concat(chunks.filter((chunk) => !chunk.out).map((chunk) => chunk.data)),
      });
    };
    child.stdout?.on('data', (data) => chunks.push({ out: true, data }));
    child.stderr?.on('data', (data) => chunks.push({ out: false, data }));
    child.on('error', (error) => resolve({ error }));
    child.on('close', () => done());
    child.on('exit', (status) => {
      code = status ?? 1;
      timer = setTimeout(done, 500);
    });
  });
}
