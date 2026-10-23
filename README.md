# slicc-open

`open` and `xdg-open` for SLICC: they open URLs and files from SLICC's file system in a browser tab, download files, and show images inline to the agent. `scopen` is the same command under a name that never clashes: in SLICC it is `open`, and on macOS, Linux and Windows it hands off to the platform's own opener (see [On a host](#on-a-host)).

This README is the spec. In SLICC the commands are POSIX sh scripts that ask seven's page through the kernel's `/dev/embedder` (see [In SLICC](#in-slicc)); on a host, `scopen` is a small Node script.

## Install

In SLICC, the package declares its commands in `slicc.commands`, so installing it puts `open`, `xdg-open` and `scopen` in `/usr/bin`:

```sh
pnpm add -g @ai-ecoverse/slicc-open
```

On a host, the installer puts `scopen` in `~/.local/bin`, with Node 24 or later, which it downloads (checked against nodejs.org's `SHASUMS256.txt`) when none is on `PATH`:

```sh
curl -fsSL https://get.sliccy.ai/open | sh
```

On Windows, in PowerShell:

```powershell
irm https://get.sliccy.ai/open.ps1 | iex
```

Without get.sliccy.ai, the same installer comes straight from the release:

```sh
curl -fsSL https://github.com/ai-ecoverse/slicc-open/releases/latest/download/install.sh | sh
```

Options reach `install.sh` after `sh -s --`, for example `curl -fsSL https://get.sliccy.ai/open | sh -s -- --version 1.2.0 --dir ~/bin`, and `install.ps1` through a script block: `& ([scriptblock]::Create((irm https://get.sliccy.ai/open.ps1))) -Version 1.2.0`. [The installer](#the-installer) has the details.

With npm, on a machine with Node 24 or later:

```sh
npm install -g @ai-ecoverse/slicc-open
scopen https://example.com
```

or without installing, `npx -p @ai-ecoverse/slicc-open scopen https://example.com`.

## Commands

| command | in SLICC | on a host | options |
| --- | --- | --- | --- |
| `open` | opens in the browser | not installed | macOS `open(1)`'s, and slicc 6's `-d` and `-v` |
| `xdg-open` | opens in the browser | not installed | `xdg-open(1)`'s |
| `scopen` | the same as `open` | the platform's opener | the same as `open` |

Each command takes one or more targets (`xdg-open`: exactly one). A target is a URL when it starts with a scheme of two or more characters and a colon (`https:`, `mailto:`, `file:`, `about:`), so `C:\notes.txt` is a path; anything else is a path, relative to the working directory. Options come before the targets; `--` ends the options, and a target after it may start with `-`.

The exit status is the same for every command: **0** when everything opened, **1** when a target or the tool failed (a file that doesn't exist, no opener on `PATH`, a tool that exits non-zero), and **2** for a usage error: an unknown option, a missing option value, no target, or an option that is unsupported where it runs. A usage error prints `<cmd>: <what is wrong>` and the usage line to stderr; an unsupported option prints `<cmd>: <option> is not supported in SLICC` (or `on Linux`, `on Windows`, `on macOS`), and one that needs `-a` there `<cmd>: <option> without -a is not supported on Linux` (or `on Windows`). Nothing is opened unless every option and target is accepted first, and with several targets, the first failure stops the rest.

### `open` and `scopen`

| option | in SLICC | macOS | Linux | Windows |
| --- | --- | --- | --- | --- |
| *target* | URL: a new tab; path: the file in a tab, from a one-off sandboxed URL | `open` | `xdg-open` | `Start-Process` |
| `-a APP` | unsupported | `open -a APP` | runs `APP` from `PATH` with the targets as its arguments | `Start-Process -FilePath APP -ArgumentList` *targets* |
| `-b BUNDLE_ID` | unsupported | `open -b` | unsupported | unsupported |
| `-e` | the file as plain text in a tab | `open -e` (TextEdit) | unsupported | Notepad |
| `-t` | the file as plain text in a tab | `open -t` | unsupported | Notepad |
| `-f` | stdin, saved to `/tmp/open-<random>.txt`, as plain text in a tab | `open -f` | stdin, saved to a temporary `.txt` file, opened with `xdg-open` | stdin, saved to a temporary `.txt` file, opened in Notepad |
| `-F` | unsupported | `open -F` | unsupported | unsupported |
| `-W` | unsupported | `open -W` | with `-a`, waits for `APP` to exit; without `-a`, unsupported | `Start-Process -Wait` |
| `-R` | asks the page to reveal the file (`open.reveal`) | `open -R` (reveals in Finder) | `xdg-open` on the file's directory | `explorer.exe /select,<path>` |
| `-n` | accepted; every target already gets a new tab | `open -n` | with `-a`, accepted (a new process is always started); without `-a`, unsupported | with `-a`, accepted (a new process is always started); without `-a`, unsupported |
| `-g` | the tab opens without taking focus | `open -g` | unsupported | unsupported |
| `-j` | unsupported | `open -j` | unsupported | `Start-Process -WindowStyle Hidden` |
| `-u URL` | `URL` in a new tab | `open -u URL` | `xdg-open URL` | `Start-Process URL` |
| `-s SDK` | unsupported | unsupported | unsupported | unsupported |
| `--args ARG…` | unsupported | `open --args` | with `-a`, appended to `APP`'s arguments; without `-a`, unsupported | with `-a`, appended to `-ArgumentList`; without `-a`, unsupported |
| `--env VAR` | unsupported | `open --env` | sets `VAR` (`NAME=VALUE` or `NAME`, which passes the current value) for the process it starts | the same, inherited by what `Start-Process` starts |
| `--stdin PATH` | unsupported | `open --stdin` | with `-a`, `APP`'s stdin; without `-a`, unsupported | with `-a`, `-RedirectStandardInput`; without `-a`, unsupported |
| `--stdout PATH` | unsupported | `open --stdout` | with `-a`, `APP`'s stdout; without `-a`, unsupported | with `-a`, `-RedirectStandardOutput`; without `-a`, unsupported |
| `--stderr PATH` | unsupported | `open --stderr` | with `-a`, `APP`'s stderr; without `-a`, unsupported | with `-a`, `-RedirectStandardError`; without `-a`, unsupported |
| `--arch ARCH` | unsupported | `open --arch` | unsupported | unsupported |
| `-d`, `--download` | downloads the file, or an http or https URL fetched with `curl`, through the page | unsupported | unsupported | unsupported |
| `-v`, `--view` | prints `<img:PATH>` for the agent to show the image inline | unsupported | unsupported | unsupported |
| `--size SPEC` | unsupported | unsupported | unsupported | unsupported |
| `-h`, `--help` | the usage, to stdout, exit 0 | the same | the same | the same |
| `--version` | the version alone (`1.2.0`), to stdout, exit 0 | the same | the same | the same |
| `--upgrade` | see [`--upgrade`](#--upgrade) | the same | the same | the same |

- **Unsupported, everywhere:** `-s` (macOS `open`'s SDK for header search) and header search itself, because `-h` is help in every slicc-open command; `scopen -h NSView` prints the usage.
- **Unsupported in SLICC:** `-a`, `-b`, `-F`, `-W`, `-j`, `-s`, `--args`, `--env`, `--stdin`, `--stdout`, `--stderr`, `--arch`, `--size`. SLICC has one browser and no applications to choose, wait for or start fresh.
- **Unsupported on macOS:** `-s`, `-d`, `-v`, `--size`. Every other option goes to `open` unchanged, except `-h`, `--help`, `--version` and `--upgrade`, which `scopen` answers itself, and `--`, which it doesn't pass on.
- **Unsupported on Linux:** `-b`, `-e`, `-t`, `-F`, `-g`, `-j`, `-s`, `--arch`, `-d`, `-v`, `--size`; `-W`, `-n`, `--args`, `--stdin`, `--stdout` and `--stderr` without `-a`.
- **Unsupported on Windows:** `-b`, `-F`, `-g`, `-s`, `--arch`, `-d`, `-v`, `--size`; `-n`, `--args`, `--stdin`, `--stdout` and `--stderr` without `-a`.
- **On Linux and Windows,** `-R` takes paths only, and no `-a`, `-e`, `-t` or `-f`; `-a` takes no `-e` or `-t`. These are usage errors.
- **`--size`** was slicc 6's box for `-v`. It is unsupported everywhere, because seven's agent fits every inline image itself (see [In SLICC](#in-slicc)), and is still parsed (with its value) so that it gives that message rather than an unknown option.
- `-u` takes a URL (a scheme of two or more characters and a colon); anything else is a usage error, and with `-f` it counts as a target.
- `-v` works on paths only, and `-d` on paths and `http:` or `https:` URLs; any other target is a usage error. Of `-d`, `-v`, `-e`, `-t` and `-f`, at most one may be given, and `-f` takes no targets. In SLICC, `-R`, `-e` and `-t` take paths only, and `-R` counts as one of those five.

### `xdg-open`

| option | does |
| --- | --- |
| *file or URL* | opens it, exactly as `open` does with one target |
| `--help` | the synopsis, to stdout, exit 0 |
| `--manual` | the full usage with the exit codes, to stdout, exit 0 |
| `--version` | slicc-open's version alone (`1.2.0`), to stdout, exit 0 |
| `--upgrade` | see [`--upgrade`](#--upgrade) |

`xdg-open` takes exactly one target and no other options, as freedesktop's does. Unlike freedesktop's, which exits 1 for a syntax error, 2 for a missing file, 3 for a missing tool and 4 for a failed action, it uses slicc-open's exit codes: 2 for a usage error and 1 for everything that failed.

### Help

`-h` and `--help` (`--help` alone for `xdg-open`) print `usage: <cmd> …` and one line per option to stdout and exit 0, wherever they appear among the options; the other arguments are not checked. `open` and `scopen` with no arguments print the same usage, to stderr, and exit 2. `--version` and `--upgrade` take no other arguments.

## In SLICC

The commands run in the slicc-kernel, while tabs and downloads belong to seven's page, the kernel's embedder. They reach it through `/dev/embedder` (slicc-kernel 1.153.0 and later), as POSIX sh over coreutils, so every error comes from a real `cat` with the kernel's errno: one request is a JSON header line `{"kind": …, …options}`, then the body, then the page's reply until EOF. The package's `engines` asks for `slicc-kernel >=1.153.0`, so an older kernel refuses to install its commands; one without the device anyway prints `<cmd>: /dev/embedder not available (needs slicc-kernel >= 1.153.0)` and exits 1, before reading any target.

- **URLs** open in a new tab. `open` writes an `open.url` request and closes the device (`O_WRONLY`), and the page's answer is the close's errno. `-g` asks for the tab without moving focus to it. seven opens only `http:` and `https:` URLs that aren't its own pages or the vault, and asks the user before it opens one; a refusal, a dismissed prompt, or 60 s without an answer is `EACCES`.
- **Files** are read by the command itself, with the caller's permissions: `open` checks each one first (`open: notes.txt: No such file or directory`, `Permission denied`, `Is a directory`, from coreutils), resolves it with `realpath` against the working directory, and sends its bytes as the body of `open.file`, with its name and the type its extension implies (`-e`, `-t` and `-f` send `text/plain`). The page serves them from a one-off sandboxed URL in a new tab, and replies with that URL. The file is served alone: its links to other files, relative or root-absolute, don't reach the file system.
- **`-f`** saves stdin to `/tmp/open-<random>.txt` and opens that file as plain text.
- **`-d`, `--download`** sends a file's bytes as `open.download`, and the page saves them to the user's machine under the file's name. With an `http:` or `https:` URL, `open` fetches it with `curl -fsSL` (a missing `curl` is `open: -d with a URL needs curl on PATH`, exit 1, before anything is sent; a failing one passes its last line on, exit 1) into a temporary file first and sends it only when `curl` succeeded, so a failed fetch sends nothing, named after the URL's last path segment (`download` when it has none). A URL given with `-u` is downloaded the same way.
- **`-R`** checks only that the path exists (a directory is fine) and sends `open.reveal` with the absolute path.
- **`-v`, `--view`** needs no page. For each path it checks that the file is readable and a PNG, JPEG, GIF or WebP image by its magic bytes (otherwise `open: <path>: not a PNG, JPEG, GIF or WebP image`, exit 1, before anything is printed), then prints one line `<img:/absolute/path>` to stdout, with the path resolved by `realpath`. A seven agent with [slicc-agent#713](https://github.com/ai-ecoverse/slicc-agent/issues/713) turns each such line into an inline image in the tool result (at most 4 per command, fit to 1600 px); anywhere else the line is shown as it is.
- **Followers:** each request goes to the page of the session the command runs in, so on a follower the tab opens and the download starts in that follower's browser. A session no page answers for is `ENOTSUP`, `no page answers requests for this session`.
- For each target, `open` prints one line to stdout: `opened <url>`, `opened <path> → <url>`, `downloaded <path or url>`, or `revealed <path>`.
- **Errors:** a request the page refuses prints `<cmd>: <target>: <the first line of the page's message>` (or the errno's text when there is none) and exits 1; `EACCES` adds `<cmd>: if seven asked, answer in seven's tab (a click allows it), then run <cmd> again`. The page's progress lines are not shown.

### The embedder contract

The kinds below are what the embedder answers; slicc-open's tests run the scripts against a fake page that answers them in a node kernel.

| kind | options | body | reply | errors |
| --- | --- | --- | --- | --- |
| `open.url` | `url`, `background` (`true` with `-g`; seven ignores it) | none, `O_WRONLY` | none | `EACCES`: `that isn't a URL`, `seven opens only http and https URLs`, `seven doesn't open its own pages or the vault for a program`, `the request to open the page was dismissed`, `nobody answered the request to open the page within 60 s` |
| `open.file` | `name`, `type` (when the extension implies one) | the file's bytes | the URL opened, and a newline | `ENOTSUP`, `EACCES`, `EIO` |
| `open.download` | `name`, `type` | the file's bytes, or the fetched URL's once the fetch succeeded | none | `ENOTSUP`, `EACCES`, `EIO` |
| `open.reveal` | `path`, absolute | none, `O_WRONLY` | none | `ENOTSUP` |

Option values are JSON strings: `"` and `\` are escaped, control characters are `\u00XX`, and anything else, UTF-8 included, is passed as it is, so no path or URL can break the header. The kernel's errno map applies (`EACCES`, `ENOTSUP`, `ENOENT`, `EIO`, `EINTR`); every errno prints the one-line message above and exits 1.

What answers which kind: seven's first page with `/dev/embedder` answers `open.url` only, so `open.file` and `open.download` are `ENOTSUP` until the seven release that adds them; `open.reveal` is `ENOTSUP` in every seven so far. `-v` works in any seven, and shows images inline with a slicc-agent that has #713.

**In SLICC, the unprefixed names win.** The package has both `bin` and `slicc.commands`, and both name `scopen`. The kernel ignores a package's `bin` entry when the same package declares that name in `slicc.commands` (where it reads `bin` at all, in its appended command roots), so `/usr/bin/scopen` is always the SLICC command. bios's base set doesn't put `bin` links on `PATH`, and after a `pnpm add -g`, bios removes the `$PNPM_HOME/bin` link pnpm made for each name a package declares in both `bin` and `slicc.commands`, so the Node script, which SLICC has no Node to run, never shadows `open`, `xdg-open` or `scopen`.

## On a host

Only `scopen` is installed (the package's `bin`, a small Node script in `host/`); the host's own `open` and `xdg-open` are never shadowed. It hands off to the platform's opener:

| platform | opener | a target is run as |
| --- | --- | --- |
| macOS | `open`, the first on `PATH` (`/usr/bin/open`) | `open` *options* *targets*, all in one call |
| Linux | `xdg-open`, else `gio open`, the first on `PATH` | `xdg-open TARGET` (or `gio open TARGET`), once per target, in order |
| Windows | `powershell.exe`, else `pwsh.exe`, the first on `PATH` | `Start-Process`, once per target, in order |

- **Spawning:** the tool runs with a fixed argv and no shell, and `scopen` exits with the status above once the opener (or with `-W`, the application) has exited. File targets are checked first (`scopen: <path>: No such file or directory`, exit 1) and passed as absolute paths, so none can be read as an option. URLs are passed unchanged. The opener's stdout is discarded, so a browser it starts can't hold the caller's pipe open. Other Unix systems are treated as Linux.
- **Windows:** `scopen` runs `powershell.exe -NoProfile -NonInteractive -Command <script>`, where the script is a constant. The targets and options reach it as JSON in the `SCOPEN_ARGV` environment variable, which the script parses and binds to `Start-Process`'s parameters (`-FilePath`, `-ArgumentList`, `-Wait`, `-WindowStyle`, `-Redirect…`), so no URL or path is ever part of the script's text. `cmd /c start` is never used. With `-a`, the targets and the `--args` reach `-ArgumentList` as one command line, quoted the way Windows programs split it. `-R` runs `explorer.exe` with the single argument `/select,<path>`, whose exit status is ignored (it is 1 even when the folder opened), and `-e`, `-t` and `-f` run `notepad.exe` with the path, without waiting unless `-W` is given.
- **`-a` on Linux** starts `APP` from `PATH`, detached unless `-W` is given, with the targets and then the `--args` as its argv; a missing `APP` prints `scopen: APP: command not found` and exits 1.
- **Errors:** with no opener on `PATH`, `scopen: no opener found (tried xdg-open, gio)` (the names tried on that platform) to stderr, exit 1. An opener that exits non-zero has its stderr passed through, and `scopen` exits 1.

## `--upgrade`

Every host command takes `--upgrade`. It runs the latest release's installer (`install.sh`, or `install.ps1` on Windows) with `--dir` set to the directory the command is installed in, so the new version replaces the old one in place, then prints `<cmd>: <old> → <new>` (for example `scopen: 1.2.0 → 1.3.0`), or `<cmd>: already up to date (<version>)`, to stdout and exits 0. If the installer fails, its stderr is passed through and the command exits 1. A command installed with npm prints `npm install -g @ai-ecoverse/<package>@latest` to run instead, and exits 0. In SLICC, `--upgrade` prints `pnpm add -g @ai-ecoverse/<package>@latest` to run, and exits 0; it installs nothing itself. `--upgrade` takes no other arguments.

For slicc-open, `<package>` is `slicc-open`, and the commands are `scopen` on a host and `open`, `xdg-open` and `scopen` in SLICC.

## The installer

This section is the installer contract that slicc-open, slicc-capture, slicc-audio and slicc-man share ([#7](https://github.com/ai-ecoverse/slicc-open/issues/7)). slicc-open's `install.sh`, `install.ps1`, `scripts/assets.mjs` and `host/upgrade.mjs` are the reference implementation, and the other repos copy them with the names swapped. The names below are written as placeholders; for slicc-open:

| placeholder | slicc-open |
| --- | --- |
| `<pkg>` | `slicc-open` (the npm package is `@ai-ecoverse/<pkg>`, the repo `ai-ecoverse/<pkg>`) |
| `<cmd>` | `scopen`, each of the package's host commands (its `bin`) |
| `<CMD>` | `SCOPEN`, `<cmd>` in upper case with `-` as `_` |

### Release assets

semantic-release's `@semantic-release/npm` packs the package into `release/` (`tarballDir`). `@semantic-release/exec` then runs `node scripts/assets.mjs release <version>`, which renames the tarball to `<pkg>-<version>.tgz`, copies `install.sh` and `install.ps1` next to it, and writes `SHA256SUMS`: one `<sha256>  <name>` line each for the tarball, `install.sh` and `install.ps1`, in that order. `@semantic-release/github` attaches all four files to the release. `ci.yml` needs no release step of its own.

### Options and exit codes

| `install.sh` | `install.ps1` | |
| --- | --- | --- |
| `--version VERSION` (or `--version=VERSION`; a leading `v` is dropped) | `-Version VERSION` | the release to install (default: the latest) |
| `--dir DIR` (or `--dir=DIR`) | `-Dir DIR` | where the launchers go (default: `~/.local/bin`; on Windows `%LOCALAPPDATA%\<pkg>\bin`) |
| `--help` (or `-h`) | `-Help` | print the usage to stdout and exit 0 |

Only the flags select anything: no environment variable stands in for `--version` or `--dir`. `install.sh` exits **0** when it installed, **1** when something failed (a download, a checksum, no Node and no way to get one), with `install.sh: <what>` on stderr, and **2** for an unknown option or a missing value, with the usage on stderr. `install.ps1` exits 0 or 1 the same way when it is run as a file, and its parameters are PowerShell's own, so an unknown one is PowerShell's error. Run through `irm … | iex` or a script block, it prints the error and returns instead of calling `exit`, so it never closes the user's PowerShell.

### Node

The launchers run the package with Node 24 or later. The installer uses the first `node` on `PATH` when it is new enough, otherwise one it downloaded before, into `<data>/node`. Failing both, it downloads the newest LTS release of 24 or later (or the newest release, when no LTS qualifies) from `index.json`. That download is `node-<version>-<os>-<arch>.tar.gz` (`darwin` or `linux`, `x64` or `arm64`), or `node-<version>-win-<arch>.zip` on Windows, checked against that release's `SHASUMS256.txt`. `.tar.gz` is used because `xz` isn't on every minimal Linux. On musl Linux, where nodejs.org has no build, the installer says to install Node with the package manager and exits 1.

### Downloads

| variable | default | |
| --- | --- | --- |
| `SLICC_INSTALL_BASE_URL` | `https://github.com/ai-ecoverse/<pkg>/releases/latest/download`, or `…/releases/download/v<version>` with `--version` | the directory holding the release assets (`SHA256SUMS`, `<pkg>-<version>.tgz`, `install.sh`, `install.ps1`) |
| `SLICC_NODE_DIST_BASE` | `https://nodejs.org/dist` | where `index.json` and `v<version>/SHASUMS256.txt` and the Node archives are |

`install.sh` fetches with `curl`, else `wget` (`curl` also reads the `file://` URLs the tests use), and checks checksums with `sha256sum`, else `shasum -a 256`. `install.ps1` uses `Invoke-WebRequest` and `Get-FileHash`. Without `--version`, the tarball is the `<pkg>-<version>.tgz` named in `SHA256SUMS`, so the version comes from the release itself. A tarball whose checksum doesn't match is refused before anything is unpacked.

### Files

The tarball is unpacked (with `tar`, `%SystemRoot%\System32\tar.exe` on Windows) into a temporary directory next to the versioned data directory `<data>/<version>`. When its `package.json` has a non-empty `dependencies` or `optionalDependencies`, the installer runs `npm install --omit=dev --ignore-scripts --no-audit --no-fund` there. It uses the npm that comes with the Node it picked, run by that Node (`<node dir>/../lib/node_modules/npm`, or `node_modules\npm` next to `node.exe`; `install.sh` falls back to `npm` on `PATH`). npm's output goes to stderr. Without such dependencies the step is skipped, so it needs neither npm nor the network. A failed `npm install`, or a missing npm, exits 1 and removes the partial directory. Only then does the directory replace `<data>/<version>`, so a failed install never leaves a broken version behind. `<data>` is `${XDG_DATA_HOME:-~/.local/share}/<pkg>`, or `%LOCALAPPDATA%\<pkg>` on Windows. Other versions stay where they are, and there is no `current` link. Each launcher names its version's entry script, `<data>/<version>/host/<cmd>.mjs`, and the Node it was installed with, by absolute path.

| platform | launchers in `DIR` | what they do |
| --- | --- | --- |
| macOS, Linux | `<cmd>`, a POSIX sh script | sets and exports `<CMD>_INSTALL_DIR='<DIR>'`, then `exec '<node>' '<entry>' "$@"`; every path is single-quoted, so no path is ever evaluated |
| Windows | `<cmd>.ps1` (UTF-8 with a BOM) | saves the caller's `$env:<CMD>_INSTALL_DIR` and sets it, runs `& '<node.exe>' '<entry>' @args` in `try`, restores the old value in `finally` (or removes the variable when it was unset), then exits with node's exit code. A `.ps1` runs inside the caller's PowerShell session, and this keeps the variable from leaking into that session |
| Windows | `<cmd>.cmd` (UTF-8, code page 65001 while it runs) | sets `<CMD>_INSTALL_DIR`, then runs `"<node.exe>" "<entry>" %* & call :done %%ERRORLEVEL%% & exit /b` as one line, so a `)` in an argument can't end anything early, and a launcher that `--upgrade` rewrites mid-run is never read again; `:done` restores the code page and exits with node's status |

Both Windows launchers only start `node.exe` with the entry script and the arguments, and `<cmd>` itself never runs `cmd.exe`. On Windows the installer adds `DIR` to the user's `PATH` when it isn't there already; elsewhere it prints the `export PATH=…` line to add when `DIR` isn't on `PATH`. After writing the launchers, the installer runs each command's `--version` and requires the version it installed, either alone (`1.2.0`) or in the older `<cmd> 1.2.0` form, so that a `--version` naming an older release still installs. Then it prints `<cmd> <version> installed to <launcher>` to stdout for each command.

### How `--upgrade` uses it

`<CMD>_INSTALL_DIR` is how a command knows the installer put it there. When it is set, `--upgrade` uses Node's `fetch` to download `install.sh` (or `install.ps1` on Windows) from `SLICC_INSTALL_BASE_URL`, or the latest release without it, into a temporary directory. The download has 60 seconds (`AbortSignal.timeout`); after that it prints `<cmd>: download timed out` to stderr and exits 1. It runs `sh install.sh --dir <CMD>_INSTALL_DIR`, or `powershell.exe` (else `pwsh.exe`) `-NoProfile -NonInteractive -ExecutionPolicy Bypass -File install.ps1 -Dir <CMD>_INSTALL_DIR`, with the installer's stderr passed through. The new version is the one in the installer's `<cmd> <version> installed to` line. A download that fails, an installer that exits non-zero or doesn't print that line, or a missing `sh` or PowerShell makes `--upgrade` exit 1. Without `<CMD>_INSTALL_DIR`, the command counts as installed with npm. Commands remove `<CMD>_INSTALL_DIR` from the environment of everything they start.

## Development

```sh
npm install
npm run lint
npm test
npm run test:unit
```

- `npm run lint`: Biome, the no-comment check and the other [slicc-shared-web](https://github.com/ai-ecoverse/slicc-shared-web) checks.
- `npm run lint` also runs `shellcheck` and `dash -n` on `install.sh` and `bin/*`.
- `npm test`: the integration tests in `test/integration/`. `repo.test.mjs` checks the workflow, the pinned tooling, the release config, the repo rules and what `npm pack` ships. `commands.test.mjs` runs `bin/*` in a node kernel from `@ai-ecoverse/slicc-kernel` with wasm-bash and wasm-coreutils, behind a fake page that records each request's kind, options and body: every kind, hostile URLs and paths in the header, each errno, the page's refusals, `-v` by magic bytes, a user who can't read the file, a session no page answers, and slicc-kernel 1.152.2 (the devDependency `slicc-kernel-without-embedder`), which refuses the package, and with `engines` stripped, has no `/dev/embedder`. The host tests run `host/` against fake `open`, `xdg-open`, `gio`, `powershell.exe`, `pwsh.exe`, `explorer.exe` and `notepad.exe` on a temporary `PATH`, with the platform forced, so each branch is checked on any machine. `install.test.mjs` runs `install.sh` on a tarball packed from the tree, with the Node on `PATH` and with a Node download from a fake `nodejs.org`, and `--upgrade` against a release served from a local directory; `install.ps1` is checked statically, and run when `pwsh` is on `PATH`.
- `npm run test:unit`: the unit tests in the gitignored `test/unit/`; `scripts/cover.mjs` writes Node's coverage of `host/`, and the line coverage of `bin/*` from the `set -x` traces the tests write to `$SLICC_OPEN_TRACE`, to `coverage/unit/lcov.info`. The pre-commit hook wants 100% coverage of the changed lines.

CI is `.github/workflows/ci.yml`, the only workflow, which runs [slicc-shared-web's pipeline](https://github.com/ai-ecoverse/slicc-shared-web#pipeline) at the devDependency's version: `npm run lint`, then `npm test`, then on a pull request the Claude and Codex reviews. The merge queue requires `ci / integration` and `ci / review`. On a push to `main`, semantic-release releases and publishes to npm through trusted publishing, with provenance from `ci.yml`.

## License

Apache-2.0
