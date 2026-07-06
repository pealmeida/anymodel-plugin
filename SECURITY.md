# Security Policy

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Use GitHub's
[private vulnerability reporting](https://github.com/pealmeida/anymodel-plugin/security/advisories/new)
to file a security advisory. You should receive a response within a week.

## Supported versions

Only the latest released version receives security fixes.

## Security model

Understanding what this project does — and does not — protect:

### API keys
- Provider credentials are **never stored in this repository or its config
  files**. `registry.toml` holds `env_key` *names*; values come from your
  environment or a local env file passed to `companion.mjs shim --env-file`.
- Keys are sent only as `Authorization: Bearer` headers to the `base_url` of
  the provider they belong to, as declared in the registry.
- Never put keys on the command line (`ps`-visible) or in files inside a repo.

### Bridges
- The built-in shim and any LiteLLM proxy bind to `127.0.0.1` only. They are
  unauthenticated local processes: any local process can use them. Do not
  expose them on other interfaces.

### Engine sandboxing (varies — read this before using `--write`)
| Engine | Sandbox |
|---|---|
| `codex`  | Codex's own OS-level sandbox (`read-only` / `workspace-write`) |
| `claude` | Claude Code permission modes (`-p` denies writes by default) |
| `direct` | **Tool-level guards only**: workspace path containment (symlink-hardened), write/exec tools exist only in `--write` mode. `exec_command` runs real shell commands with no OS sandbox. |

Treat model output as untrusted input. Do not run `--engine direct --write`
against repositories you cannot afford to have mutated, and review delegated
changes before committing them.

### Delegated content
Prompts, file contents, and diffs you delegate are sent to the provider you
select. Choose providers according to your data-handling requirements.
