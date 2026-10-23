# slicc-open

`open` and `xdg-open` for SLICC: they open URLs and files from SLICC's file system in a browser tab, download files, and show images inline to the agent. `scopen` is the same command under a name that never clashes: in SLICC it is `open`, and on macOS, Linux and Windows it hands off to the platform's own opener (see [On a host](#on-a-host)).

This README is the spec. The host command is described as it will ship in the first release; the SLICC side is **planned**, waiting on the kernel-to-page bridge (see [In SLICC](#in-slicc)).

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
| `open` | opens in the browser | not installed | macOS `open(1)`'s, and slicc 6's `-d`, `-v`, `--size` |
| `xdg-open` | opens in the browser | not installed | `xdg-open(1)`'s |
| `scopen` | the same as `open` | the platform's opener | the same as `open` |

Each command takes one or more targets (`xdg-open`: exactly one). A target is a URL when it starts with a scheme of two or more characters and a colon (`https:`, `mailto:`, `file:`, `about:`), so `C:\notes.txt` is a path; anything else is a path, relative to the working directory. Options come before the targets; `--` ends the options, and a target after it may start with `-`.

The exit status is the same for every command: **0** when everything opened, **1** when a target or the tool failed (a file that doesn't exist, no opener on `PATH`, a tool that exits non-zero), and **2** for a usage error: an unknown option, a missing option value, no target, or an option that is unsupported where it runs. A usage error prints `<cmd>: <what is wrong>` and the usage line to stderr; an unsupported option prints `<cmd>: <option> is not supported in SLICC` (or `on Linux`, `on Windows`, `on macOS`), and one that needs `-a` there `<cmd>: <option> without -a is not supported on Linux` (or `on Windows`). Nothing is opened unless every option and target is accepted first, and with several targets, the first failure stops the rest.

### `open` and `scopen`

| option | in SLICC | macOS | Linux | Windows |
| --- | --- | --- | --- | --- |
| *target* | URL: a new tab; path: the file in a tab, through seven's service worker | `open` | `xdg-open` | `Start-Process` |
| `-a APP` | unsupported | `open -a APP` | runs `APP` from `PATH` with the targets as its arguments | `Start-Process -FilePath APP -ArgumentList` *targets* |
| `-b BUNDLE_ID` | unsupported | `open -b` | unsupported | unsupported |
| `-e` | the file as plain text in a tab | `open -e` (TextEdit) | unsupported | Notepad |
| `-t` | the file as plain text in a tab | `open -t` | unsupported | Notepad |
| `-f` | stdin, saved to `/tmp/open-<random>.txt`, as plain text in a tab | `open -f` | stdin, saved to a temporary `.txt` file, opened with `xdg-open` | stdin, saved to a temporary `.txt` file, opened in Notepad |
| `-F` | unsupported | `open -F` | unsupported | unsupported |
| `-W` | unsupported | `open -W` | with `-a`, waits for `APP` to exit; without `-a`, unsupported | `Start-Process -Wait` |
| `-R` | unsupported | `open -R` (reveals in Finder) | `xdg-open` on the file's directory | `explorer.exe /select,<path>` |
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
| `-d`, `--download` | downloads the file through the page | unsupported | unsupported | unsupported |
| `-v`, `--view` | returns the image inline to the agent | unsupported | unsupported | unsupported |
| `--size SPEC` | with `-v`, the box the image is fit into | unsupported | unsupported | unsupported |
| `-h`, `--help` | the usage, to stdout, exit 0 | the same | the same | the same |
| `--version` | the version alone (`1.2.0`), to stdout, exit 0 | the same | the same | the same |
| `--upgrade` | see [`--upgrade`](#--upgrade) | the same | the same | the same |

- **Unsupported, everywhere:** `-s` (macOS `open`'s SDK for header search) and header search itself, because `-h` is help in every slicc-open command; `scopen -h NSView` prints the usage.
- **Unsupported in SLICC:** `-a`, `-b`, `-F`, `-W`, `-R`, `-j`, `-s`, `--args`, `--env`, `--stdin`, `--stdout`, `--stderr`, `--arch`. SLICC has one browser and no applications to choose, wait for or start fresh.
- **Unsupported on macOS:** `-s`, `-d`, `-v`, `--size`. Every other option goes to `open` unchanged, except `-h`, `--help`, `--version` and `--upgrade`, which `scopen` answers itself, and `--`, which it doesn't pass on.
- **Unsupported on Linux:** `-b`, `-e`, `-t`, `-F`, `-g`, `-j`, `-s`, `--arch`, `-d`, `-v`, `--size`; `-W`, `-n`, `--args`, `--stdin`, `--stdout` and `--stderr` without `-a`.
- **Unsupported on Windows:** `-b`, `-F`, `-g`, `-s`, `--arch`, `-d`, `-v`, `--size`; `-n`, `--args`, `--stdin`, `--stdout` and `--stderr` without `-a`.
- **On Linux and Windows,** `-R` takes paths only, and no `-a`, `-e`, `-t` or `-f`; `-a` takes no `-e` or `-t`. These are usage errors.
- **`--size`** takes `low` (256x256), `medium` (768x768), `high` (1536x1536) or `WxH` (for example `512x512`), as in slicc 6. The image is fit inside the box with its aspect ratio kept, and never scaled up. `-v` without `--size` inlines nothing: it prints the image's native size, its bytes and type, and the `--size` choices to stderr, and exits 1, so one unbounded image can't fill the agent's context. `--size` without `-v` is a usage error.
- `-u` takes a URL (a scheme of two or more characters and a colon); anything else is a usage error, and with `-f` it counts as a target.
- `-d` and `-v` work on paths only; with a URL they are a usage error. Of `-d`, `-v`, `-e`, `-t` and `-f`, at most one may be given, and `-f` takes no targets.

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

The commands run in the slicc-kernel, while tabs, downloads and the service worker belong to seven's page, the kernel's embedder. How the kernel reaches the page is being agreed, once for slicc-open, slicc-capture and slicc-audio, in a slicc-kernel issue; [slicc-clipboard](https://github.com/ai-ecoverse/slicc-clipboard) did it with a character device answered by the embedder's hook. Until that lands, everything in this section is **planned**, and this README will name the bridge when it is settled.

- **URLs** (planned) open in a new tab through seven's page. A tab opened without a user gesture may be blocked; then the page asks the user to allow it, and `open` waits for the answer. A refusal prints `open: the user did not allow opening <url>` and exits 1. `-g` opens the tab without moving focus to it.
- **Files** (planned) from the file system (OPFS and the other mounts) open in a new tab, served through seven's service worker with the type their name implies; `-e` and `-t` serve them as `text/plain`. A directory opens its listing, or its index page.
- **Project root:** a page's root-absolute links (`/styles/styles.css` in `index.html`) resolve against the file's project root, as in slicc 6: the nearest directory, from the file's own directory upward (from the directory itself when the target is one), that has a `head.html`, `fstab.yaml`, `package.json` or `.git`, in that order; with none, the file's own directory.
- **`-d`, `--download`** (planned) saves the file to the user's machine through the page, under its own name, and prints `downloaded <path>`.
- **`-v`, `--view`** (planned) decodes the image, fits it into the `--size` box, and puts it inline in the agent's tool result, after a line with the path, the native and the new size, the bytes and the type. The marker that carries the image is being agreed with slicc-agent.
- **Followers** (planned): on a follower, `open` opens the tab, starts the download or reads the file in that follower's browser, not the leader's.
- For each target, `open` prints one line to stdout: `opened <url>`, or `opened <path> → <preview url>`.
- When the kernel has no bridge to a page (seven not running, or a kernel too old), every command except `-h`, `--help`, `--version` and `--upgrade` prints `open: no page to open in` and exits 1, before reading any target.

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

The tarball is unpacked (with `tar`, `%SystemRoot%\System32\tar.exe` on Windows) into the versioned data directory `<data>/<version>`, replacing that version's directory if it exists. `<data>` is `${XDG_DATA_HOME:-~/.local/share}/<pkg>`, or `%LOCALAPPDATA%\<pkg>` on Windows. Other versions stay where they are, and there is no `current` link. Each launcher names its version's entry script, `<data>/<version>/host/<cmd>.mjs`, and the Node it was installed with, by absolute path.

| platform | launchers in `DIR` | what they do |
| --- | --- | --- |
| macOS, Linux | `<cmd>`, a POSIX sh script | sets and exports `<CMD>_INSTALL_DIR='<DIR>'`, then `exec '<node>' '<entry>' "$@"`; every path is single-quoted, so no path is ever evaluated |
| Windows | `<cmd>.ps1` (UTF-8 with a BOM) | sets `$env:<CMD>_INSTALL_DIR`, then `& '<node.exe>' '<entry>' @args` and `exit $LASTEXITCODE` |
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
- `npm test`: the integration tests in `test/integration/`. `repo.test.mjs` checks the workflow, the pinned tooling, the release config, the repo rules and what `npm pack` ships. The host tests run `host/` against fake `open`, `xdg-open`, `gio`, `powershell.exe`, `pwsh.exe`, `explorer.exe` and `notepad.exe` on a temporary `PATH`, with the platform forced, so each branch is checked on any machine. `install.test.mjs` runs `install.sh` on a tarball packed from the tree, with the Node on `PATH` and with a Node download from a fake `nodejs.org`, and `--upgrade` against a release served from a local directory; `install.ps1` is checked statically, and run when `pwsh` is on `PATH`.
- `npm run test:unit`: the unit tests in the gitignored `test/unit/`; `scripts/cover.mjs` writes Node's coverage of `host/` to `coverage/unit/lcov.info`. The pre-commit hook wants 100% coverage of the changed lines.

CI is `.github/workflows/ci.yml`, the only workflow, which runs [slicc-shared-web's pipeline](https://github.com/ai-ecoverse/slicc-shared-web#pipeline) at the devDependency's version: `npm run lint`, then `npm test`, then on a pull request the Claude and Codex reviews. The merge queue requires `ci / integration` and `ci / review`. On a push to `main`, semantic-release releases and publishes to npm through trusted publishing, with provenance from `ci.yml`.

## License

Apache-2.0
