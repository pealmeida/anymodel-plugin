# Demo system

Two workflows for creating terminal recordings — ads, demos, guides, and bug reports.

## 1 · Scripted recording (`asciinema` + `agg`)

Write a shell script that types commands and captures real output, record it with
`asciinema`, then convert to GIF with `agg`. No API keys needed for help/setup/status
commands; use real keys for live delegation demos.

```bash
# record a scripted session
asciinema rec --overwrite demos/output/my-demo.cast -c "demos/scripts/my-demo.sh"

# convert to GIF
agg demos/output/my-demo.cast demos/output/my-demo.gif --font-size 14 --theme monokai
```

## 2 · Interactive recording

Record a live terminal session (with real API keys, real output), then convert.

```bash
# record interactively
./demos/record.sh my-demo

# convert to GIF
agg demos/output/my-demo.cast demos/output/my-demo.gif --font-size 14 --theme monokai
```

The `record.sh` helper starts an asciinema recording in a subshell. Type `exit` or Ctrl-D to stop.

## 3 · Declarative tapes (`vhs`)

Reproducible, CI-friendly `.tape` scripts. Requires a browser sandbox (Chromium).

```bash
vhs demos/scripts/anymodel-hero.tape          # → demos/output/hero.gif
vhs demos/scripts/anymodel-hero.tape -o mp4   # → demos/output/hero.mp4
```

Tapes live in `demos/scripts/`. See [vhs](https://github.com/charmbracelet/vhs) for the `.tape` syntax.

## Output

Generated files land in `demos/output/` (gitignored). The hero GIF lives at `docs/assets/hero.gif` (committed).

## Dependencies

- [asciinema](https://asciinema.org) — `pip install asciinema`
- [agg](https://github.com/asciinema/agg) — asciinema → GIF converter
- [vhs](https://github.com/charmbracelet/vhs) — declarative tape → GIF/MP4 (optional, needs Chromium)
- [ffmpeg](https://ffmpeg.org) — required by vhs for rendering
