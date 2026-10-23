import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const [dir, version] = process.argv.slice(2);
if (!dir || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version ?? '')) {
  console.error('usage: node scripts/assets.mjs DIR VERSION');
  process.exit(2);
}
const out = resolve(dir);
const packed = join(out, `ai-ecoverse-slicc-open-${version}.tgz`);
const tarball = `slicc-open-${version}.tgz`;
if (existsSync(packed)) renameSync(packed, join(out, tarball));
if (!existsSync(join(out, tarball))) {
  console.error(`scripts/assets.mjs: no ${packed}`);
  process.exit(1);
}
for (const name of ['install.sh', 'install.ps1']) copyFileSync(join(root, name), join(out, name));
const sums = [tarball, 'install.sh', 'install.ps1']
  .map(
    (name) =>
      `${createHash('sha256')
        .update(readFileSync(join(out, name)))
        .digest('hex')}  ${name}\n`
  )
  .join('');
writeFileSync(join(out, 'SHA256SUMS'), sums);
process.stdout.write(sums);
