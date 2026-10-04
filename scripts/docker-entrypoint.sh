#!/bin/sh
# Container entrypoint: syncs the repo's marketplace skills into the
# persistent volume on every start, then hands off to the automaton runtime.
set -e

SKILLS_DIR="${HOME:-/root}/.automaton/skills"

if [ -d "$SKILLS_DIR" ] && [ -d /app/skills ]; then
  for src in /app/skills/*/; do
    name="$(basename "$src")"
    mkdir -p "$SKILLS_DIR/$name"
    cp "$src/SKILL.md" "$SKILLS_DIR/$name/SKILL.md"
  done
  # Conway default skills are meaningless without Conway (and "survival"
  # pushes child spawning), so drop them when no Conway key is configured.
  if ! grep -q '"conwayApiKey": "cnwy' "${HOME:-/root}/.automaton/automaton.json" 2>/dev/null; then
    rm -rf "$SKILLS_DIR/conway-compute" "$SKILLS_DIR/conway-payments" "$SKILLS_DIR/survival"
  fi
fi

exec node /app/dist/index.js "$@"
