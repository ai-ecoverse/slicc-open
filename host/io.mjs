import { writeSync } from 'node:fs';

export function say(fd, text) {
  writeSync(fd, text);
}

export function fail(ctx, text) {
  say(ctx.fds[2], `scopen: ${text}\n`);
  return 1;
}
