export const windowsScript = [
  "$ErrorActionPreference = 'Stop'",
  "$ProgressPreference = 'SilentlyContinue'",
  'try {',
  '  foreach ($item in (ConvertFrom-Json $env:SCOPEN_ARGV)) {',
  '    $params = @{ FilePath = $item.FilePath }',
  "    foreach ($name in 'ArgumentList', 'WindowStyle', 'RedirectStandardInput', 'RedirectStandardOutput', 'RedirectStandardError') {",
  '      if ($item.$name) { $params[$name] = $item.$name }',
  '    }',
  '    if ($item.Wait) { $params.Wait = $true; $params.PassThru = $true }',
  '    $process = Start-Process @params',
  '    if ($item.Wait -and $process -and $process.ExitCode -ne 0) { exit 1 }',
  '  }',
  '} catch {',
  '  [Console]::Error.WriteLine($_.Exception.Message)',
  '  exit 1',
  '}',
].join('\n');

function quote(arg) {
  if (arg !== '' && !/[\s"]/.test(arg)) return arg;
  let out = '"';
  let slashes = 0;
  for (const char of arg) {
    if (char === '\\') {
      slashes++;
      continue;
    }
    out += '\\'.repeat(char === '"' ? slashes * 2 + 1 : slashes) + char;
    slashes = 0;
  }
  return `${out}${'\\'.repeat(slashes * 2)}"`;
}

export function windowsCommandLine(args) {
  return args.map(quote).join(' ');
}
