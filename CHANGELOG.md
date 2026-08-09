# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project adheres to
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.3.1] - 2026-08-08

### Added
- GitHub Pages project site (`docs/`) — Dark Node themed landing page with the
  Universal Node Cluster logo (`docs/assets/logo.svg`), served from `/docs` on `main`.
- `CHANGELOG.md`.
- `prepublishOnly` npm hook running the test suite before any publish.

### Changed
- README redesigned with centered hero, logo, site badge, and a restructured
  quick-start section optimized for both human users and AI agents.
- Test suite is hermetic by default: no test makes live provider API calls unless
  `ANYMODEL_LIVE_TESTS=1` is set. MCP turn-command tests scrub provider credentials and
  assert the missing-key error path instead.
- `npm test` runs bare `node --test` (test-runner auto-discovery; portable across shells
  and Node 18/20/22).

### Fixed
- `plugins/.npmignore` blocks local env/state files (`*.env`, `*.env.runtime`, `*.log`) from
  the published tarball — npm does not apply root `.gitignore` rules inside
  `files`-whitelisted directories, so `.gitignore` alone was insufficient.

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

[Unreleased]: https://github.com/pealmeida/anymodel-plugin/compare/v0.3.1...HEAD
[0.3.1]: https://github.com/pealmeida/anymodel-plugin/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/pealmeida/anymodel-plugin/releases/tag/v0.3.0
