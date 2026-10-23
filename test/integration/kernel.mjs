import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { createNodeKernel } from '@ai-ecoverse/slicc-kernel/node';
import { createNodeKernel as createOldKernel } from 'slicc-kernel-without-embedder/node';

const root = resolve(import.meta.dirname, '../..');

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

async function install(
  kernel,
  name,
  dir,
  files,
  modules = '/node_modules',
  edit = (_rel, data) => data
) {
  for (const path of files) {
    const rel = relative(dir, path).replaceAll('\\', '/');
    await kernel.writeFile(`${modules}/${name}/${rel}`, edit(rel, readFileSync(path)));
  }
}

export async function boot(options = {}, { create = createNodeKernel, engines = true } = {}) {
  const kernel = await create(options);
  for (const name of ['@ai-ecoverse/wasm-bash', '@ai-ecoverse/wasm-coreutils']) {
    const dir = join(root, 'node_modules', name);
    await install(kernel, name, dir, walk(dir));
  }
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const own = [join(root, 'package.json'), ...pkg.files.flatMap((file) => walk(join(root, file)))];
  const edit = (rel, data) => {
    if (engines || rel !== 'package.json') return data;
    const copy = JSON.parse(data.toString('utf8'));
    delete copy.engines['slicc-kernel'];
    return Buffer.from(JSON.stringify(copy));
  };
  await install(kernel, pkg.name, root, own, '/node_modules', edit);
  return {
    kernel,
    sh: (script, opts = {}) => kernel.run(['sh', '-c', script], { cwd: '/tmp', ...opts }),
    run: (argv, opts = {}) => kernel.run(argv, { cwd: '/tmp', ...opts }),
    close: () => kernel.terminate(),
  };
}

export const bootOld = (engines) => boot({}, { create: createOldKernel, engines });
