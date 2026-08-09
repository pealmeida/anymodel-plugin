# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project adheres to
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- `CHANGELOG.md`.
- `prepublishOnly` npm hook running the test suite before any publish.

### Fixed
- `plugins/.npmignore` blocks local env/state files (`*.env`, `*.env.runtime`, `*.log`) from
  the published tarball — npm does not apply root `.gitignore` rules inside
  `files`-whitelisted directories, so `.gitignore` alone was insufficient.

### Changed
- README rewritten as a comprehensive open-source guide.
- Test suite is hermetic by default: no test makes live provider API calls unless
  `ANYMODEL_LIVE_TESTS=1` is set. MCP turn-command tests scrub provider credentials and
  assert the missing-key error path instead.
- `npm test` runs bare `node --test` (test-runner auto-discovery; portable across shells
  and Node 18/20/22).

### Removed
- Codex branding and the `anymodel_` MCP tool prefix.
- Empty top-level `scripts/` directory and its `package.json` `files` entry.

## [0.3.0] - 2026-07-06

### Added
- Any-agent portability: MCP stdio server exposing 8 tools, npm `bin` entries
  (`anymodel`, `anymodel-mcp`), and per-host setup in INTEGRATIONS.md.
- Claude Code plugin surface: 11 slash commands plus the `anymodel-runner` subagent;
  marketplace install via `.claude-plugin/marketplace.json`.
- `models` and `setup` commands for provider probing and readiness checks.
- Built-in `direct` engine: a zero-dependency agent loop speaking OpenAI-compatible
  chat completions to any registry provider.
- SECURITY.md (private vulnerability reporting, per-engine sandbox model),
  CONTRIBUTING.md, and a GitHub Actions CI workflow (Node 18/20/22 matrix, MCP
  protocol smoke test).
- NOTICE attributing the `openai/codex-plugin-cc` fork provenance.

[Unreleased]: https://github.com/pealmeida/anymodel-plugin/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/pealmeida/anymodel-plugin/releases/tag/v0.3.0
