const shortFlags = new Set(['e', 't', 'f', 'F', 'W', 'R', 'n', 'g', 'j', 'd', 'v', 'h']);
const shortValues = new Set(['a', 'b', 'u', 's']);
const longFlags = {
  '--download': '-d',
  '--view': '-v',
  '--help': '-h',
  '--version': '--version',
  '--upgrade': '--upgrade',
};
const longValues = new Set(['--env', '--stdin', '--stdout', '--stderr', '--arch', '--size']);

export const usage =
  'usage: scopen [-a APP | -b BUNDLE_ID] [-e | -t | -f] [-FWRngj] [-u URL] [--env VAR] [--stdin PATH] [--stdout PATH] [--stderr PATH] [--arch ARCH] [--] [TARGET ...] [--args ARG ...]';

export const help = `${usage}
  TARGET          a URL (a scheme of two or more characters and a colon) or a path
  -a APP          open with APP
  -b BUNDLE_ID    open with the application with this bundle id (macOS)
  -e              open in TextEdit (macOS) or Notepad (Windows)
  -t              open in the default text editor (macOS) or Notepad (Windows)
  -f              read stdin into a temporary file and open it as text
  -F              open fresh, without restoring windows (macOS)
  -W              wait for the application to exit
  -R              reveal the target in the file manager
  -n              start a new instance of the application
  -g              keep the application in the background (macOS)
  -j              start the application hidden (macOS, Windows)
  -u URL          open URL, even when it is also a path
  --args ARG ...  pass the rest of the arguments to the application
  --env VAR       set VAR (NAME=VALUE, or NAME for its current value) for the application
  --stdin PATH    the application's stdin
  --stdout PATH   the application's stdout
  --stderr PATH   the application's stderr
  --arch ARCH     start the application with this architecture (macOS)
  -h, --help      print this usage and exit
  --version       print scopen's version and exit
  --upgrade       upgrade scopen to the latest release
exit status: 0 when everything opened, 1 when a target or the tool failed, 2 for a usage error
`;

function long(arg, argv, index, parsed) {
  const at = arg.indexOf('=');
  const name = at === -1 ? arg : arg.slice(0, at);
  if (longFlags[name]) {
    if (at !== -1) return { error: `${name} takes no value`, next: index + 1 };
    parsed.options.push({ name: longFlags[name], shown: name });
    return { next: index + 1 };
  }
  if (!longValues.has(name)) return { error: `unknown option ${name}`, next: index + 1 };
  if (at !== -1) {
    parsed.options.push({ name, shown: name, value: arg.slice(at + 1) });
    return { next: index + 1 };
  }
  if (index + 1 >= argv.length) return { error: `${name} needs a value`, next: index + 1 };
  parsed.options.push({ name, shown: name, value: argv[index + 1] });
  return { next: index + 2 };
}

function short(arg, argv, index, parsed) {
  let error;
  for (let at = 1; at < arg.length; at++) {
    const letter = arg[at];
    const name = `-${letter}`;
    if (shortFlags.has(letter)) {
      parsed.options.push({ name, shown: name });
      continue;
    }
    if (!shortValues.has(letter)) {
      error ??= `unknown option ${name}`;
      continue;
    }
    if (at + 1 < arg.length) {
      parsed.options.push({ name, shown: name, value: arg.slice(at + 1) });
      return { error, next: index + 1 };
    }
    if (index + 1 >= argv.length)
      return { error: error ?? `${name} needs a value`, next: index + 1 };
    parsed.options.push({ name, shown: name, value: argv[index + 1] });
    return { error, next: index + 2 };
  }
  return { error, next: index + 1 };
}

export function parse(argv) {
  const parsed = { options: [], targets: [], args: undefined, error: undefined };
  let index = 0;
  let targets = false;
  while (index < argv.length) {
    const arg = argv[index];
    if (arg === '--') {
      parsed.targets.push(...argv.slice(index + 1));
      break;
    }
    if (arg === '--args') {
      parsed.args = argv.slice(index + 1);
      break;
    }
    if (targets || !arg.startsWith('-') || arg === '-') {
      targets = true;
      parsed.targets.push(arg);
      index++;
      continue;
    }
    const step = arg.startsWith('--')
      ? long(arg, argv, index, parsed)
      : short(arg, argv, index, parsed);
    parsed.error ??= step.error;
    index = step.next;
  }
  return parsed;
}

export function isUrl(target) {
  return /^[A-Za-z][A-Za-z0-9+.-]+:/.test(target);
}
