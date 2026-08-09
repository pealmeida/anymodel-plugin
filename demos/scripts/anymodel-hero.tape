# Any Model Plugin — hero demo (30s, no API keys needed)
# Renders with: vhs demos/scripts/anymodel-hero.tape

Output demos/output/hero.gif

Set Shell "bash"
Set FontSize 14
Set Width 82
Set Height 26
Set Theme "Monokai Extended"
Set Padding 4
Set Framerate 24
Set PlaybackSpeed 1
Set Margin 0
Set MarginFill "#1A1A1A"
Set CursorBlink true

# ── intro ──
Type "clear"
Enter
Sleep 500ms

# ── setup ──
Type "# Any Model Plugin — vendor-agnostic AI orchestration"
Enter
Sleep 300ms
Type "node plugins/anymodel/scripts/companion.mjs setup"
Enter
Sleep 2s

# ── models ──
Type "node plugins/anymodel/scripts/companion.mjs models"
Enter
Sleep 2s

# ── delegate ──
Type "# Delegate a task to any engine × any model"
Enter
Sleep 300ms
Type "node plugins/anymodel/scripts/companion.mjs delegate --help"
Enter
Sleep 1s

# ── adversarial review ──
Type "# Adversarial review: a different model challenges the implementation"
Enter
Sleep 300ms
Type "node plugins/anymodel/scripts/companion.mjs adversarial-review --help"
Enter
Sleep 1s

# ── MCP server ──
Type "# MCP server: 8 tools in Cursor, Windsurf, VS Code, Codex, Claude"
Enter
Sleep 300ms
Type "node plugins/anymodel/scripts/companion.mjs setup --json"
Enter
Sleep 2s

# ── status ──
Type "# Background jobs: status, result, cancel"
Enter
Sleep 300ms
Type "node plugins/anymodel/scripts/companion.mjs status"
Enter
Sleep 1s

# ── hold ──
Sleep 1s
