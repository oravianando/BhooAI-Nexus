# @bhooai/nexus-cli

The `nexus` CLI: `init`, `dev`, `doctor`, and a multi-process supervisor.

## Commands

| command | what it does |
| --- | --- |
| `init [target] [--force]` | scaffold a new Nexus project from `templates/` |
| `dev [--only a,b]` | start backend + frontend + AI + admin under the supervisor |
| `doctor` | verify node/python versions and mongo/redis reachability (advisory) |
| `build` / `test` / `plugin` / `add` | reserved/forwarded to the workspace tools |

## Templates

`templates/` holds the real project files copied by `init` — a runnable backend
(boots `NexusServer` with the security stack + `/health`, `/csrf-token`, `/echo`),
a React+Vite frontend, a Python FastAPI AI server, an admin shell, and the CLI
`bin/nexus.js` shim. `init` is idempotent (skips existing files unless `--force`).

## Supervisor

`Supervisor` owns the four child processes, streams prefixed logs, handles
graceful Ctrl-C, and exposes a localhost HTTP control API (start/stop/restart/
status/logs-tail) that the admin app consumes — decoupling admin from
OS-specific process management.

## Usage

```bash
node bin/nexus.js init ./my-app
node bin/nexus.js doctor
node bin/nexus.js dev
```