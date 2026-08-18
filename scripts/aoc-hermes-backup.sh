#!/usr/bin/env bash
set -euo pipefail

BACKUP_DIR="/var/backups/aoc-hermes"
TIMESTAMP=$(date +"%Y-%m-%d_%H%M%S")
TEMP_DIR=$(mktemp -d /tmp/aoc-backup-XXXXXX)
LOG_FILE="/var/log/aoc-backup.log"
RETENTION_DAYS=14

mkdir -p "${BACKUP_DIR}"
chmod 700 "${BACKUP_DIR}"

log() {
  echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] $1" | tee -a "${LOG_FILE}"
}

log "=== Starting AOC & Hermes Database Backup ==="

cleanup() {
  rm -rf "${TEMP_DIR}"
}
trap cleanup EXIT

# 1. Back up AOC State DB
if [ -f "/var/lib/agent-operations-center/aoc.db" ]; then
  mkdir -p "${TEMP_DIR}/aoc"
  target_file="${TEMP_DIR}/aoc/aoc.db"
  sqlite3 "/var/lib/agent-operations-center/aoc.db" ".backup ${target_file}"
  CHECK=$(sqlite3 "${target_file}" "PRAGMA integrity_check;")
  if [ "${CHECK}" != "ok" ]; then
    log "ERROR: Integrity check failed for aoc.db backup"
    exit 1
  fi
  log "Backed up aoc.db (integrity: ok)"
fi

# 2. Back up Authelia Users Database
if [ -f "/root/agent-operations-center/deploy/authelia/users_database.yml" ]; then
  mkdir -p "${TEMP_DIR}/authelia"
  cp "/root/agent-operations-center/deploy/authelia/users_database.yml" "${TEMP_DIR}/authelia/users_database.yml"
  log "Backed up users_database.yml"
fi

# 3. Back up Hermes Kanban Boards
mkdir -p "${TEMP_DIR}/hermes/boards"
for board_db in /root/.hermes/kanban/boards/*/kanban.db; do
  if [ -f "${board_db}" ]; then
    board_name=$(basename "$(dirname "${board_db}")")
    mkdir -p "${TEMP_DIR}/hermes/boards/${board_name}"
    target_file="${TEMP_DIR}/hermes/boards/${board_name}/kanban.db"
    sqlite3 "${board_db}" ".backup ${target_file}"
    CHECK=$(sqlite3 "${target_file}" "PRAGMA integrity_check;")
    if [ "${CHECK}" != "ok" ]; then
      log "ERROR: Integrity check failed for board ${board_name}"
      exit 1
    fi
    log "Backed up kanban board [${board_name}] (integrity: ok)"
  fi
done

# 4. Back up additional Hermes Databases
for extra_db in /root/.hermes/kanban.db /root/.hermes/projects.db /root/.hermes/cron/executions.db /root/.hermes/state.db; do
  if [ -f "${extra_db}" ]; then
    rel_name=$(basename "${extra_db}")
    target_file="${TEMP_DIR}/hermes/${rel_name}"
    sqlite3 "${extra_db}" ".backup ${target_file}"
    CHECK=$(sqlite3 "${target_file}" "PRAGMA integrity_check;")
    if [ "${CHECK}" = "ok" ]; then
      log "Backed up extra db [${rel_name}] (integrity: ok)"
    fi
  fi
done

# 5. Compress into tar.gz
ARCHIVE_FILE="${BACKUP_DIR}/aoc-hermes-backup-${TIMESTAMP}.tar.gz"
tar -czf "${ARCHIVE_FILE}" -C "${TEMP_DIR}" .
chmod 600 "${ARCHIVE_FILE}"
ARCHIVE_SIZE=$(du -h "${ARCHIVE_FILE}" | cut -f1)

log "Created archive: ${ARCHIVE_FILE} (${ARCHIVE_SIZE})"

# 6. Update last-backup timestamp marker
echo "${TIMESTAMP}" > /var/lib/agent-operations-center/.aoc-last-backup

# 7. Rotation (remove backups older than RETENTION_DAYS)
DELETED=$(find "${BACKUP_DIR}" -name "aoc-hermes-backup-*.tar.gz" -mtime +"${RETENTION_DAYS}" -print -delete | wc -l)
log "Retention policy applied: deleted ${DELETED} old archive(s)"

log "=== Backup completed successfully ==="
