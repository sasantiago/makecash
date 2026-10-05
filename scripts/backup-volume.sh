#!/bin/sh
# Runs inside a throwaway container with both agent volumes mounted and the
# host backup folder at /backup. Usage: backup-volume.sh <archive-name.tgz>
set -e

archive="$1"
[ -n "$archive" ] || { echo "usage: $0 <archive-name.tgz>" >&2; exit 2; }

# SQLite via its backup API: consistent even while the agent is writing.
node -e "
const Database = require('/app/node_modules/better-sqlite3');
new Database('/root/.automaton/state.db', { readonly: true })
  .backup('/tmp/state.db')
  .then(() => process.exit(0))
  .catch((err) => { console.error(err); process.exit(1); });
"

# Cloned task repos and npm/pnpm caches are skipped; the live DB files are
# replaced by the consistent copy at tmp/state.db.
tar czf "/backup/$archive" -C / \
  --exclude=root/.npm --exclude=root/.cache --exclude=root/.local/share/pnpm \
  --exclude='root/.automaton/work/*/tasks' \
  --exclude=root/.automaton/state.db --exclude='root/.automaton/state.db-*' \
  root tmp/state.db
