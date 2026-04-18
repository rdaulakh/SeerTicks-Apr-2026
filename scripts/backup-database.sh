#!/bin/bash

###############################################################################
# SEER Trading Platform - Database Backup Script
# Based on PRODUCTION.md requirements
#
# Features:
# - Daily automated backups
# - Retention policy (30 days daily, 12 months monthly)
# - S3 upload support
# - Backup verification
# - Email notifications on failure
###############################################################################

set -e  # Exit on error
set -u  # Exit on undefined variable

# Configuration
BACKUP_DIR="${BACKUP_DIR:-/var/backups/seer}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
RETENTION_MONTHS="${RETENTION_MONTHS:-12}"
S3_BUCKET="${S3_BUCKET:-}"
NOTIFY_EMAIL="${NOTIFY_EMAIL:-}"

# Database configuration (from environment)
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-3306}"
DB_USER="${DB_USER:-}"
DB_PASSWORD="${DB_PASSWORD:-}"
DB_NAME="${DB_NAME:-seer}"

# Timestamp
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
DATE=$(date +%Y%m%d)
MONTH=$(date +%Y%m)

# Backup filename
BACKUP_FILE="${BACKUP_DIR}/daily/seer_backup_${TIMESTAMP}.sql.gz"
MONTHLY_BACKUP_FILE="${BACKUP_DIR}/monthly/seer_backup_${MONTH}.sql.gz"

# Create backup directories
mkdir -p "${BACKUP_DIR}/daily"
mkdir -p "${BACKUP_DIR}/monthly"
mkdir -p "${BACKUP_DIR}/logs"

# Log file
LOG_FILE="${BACKUP_DIR}/logs/backup_${DATE}.log"

# Logging function
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "${LOG_FILE}"
}

# Error handler
error_exit() {
    log "ERROR: $1"
    
    # Send email notification if configured
    if [ -n "${NOTIFY_EMAIL}" ]; then
        echo "Database backup failed: $1" | mail -s "SEER Backup Failure" "${NOTIFY_EMAIL}"
    fi
    
    exit 1
}

# Start backup
log "Starting database backup..."

# Check if database credentials are set
if [ -z "${DB_USER}" ] || [ -z "${DB_PASSWORD}" ]; then
    error_exit "Database credentials not set (DB_USER, DB_PASSWORD)"
fi

# Perform backup
log "Backing up database ${DB_NAME}..."
if ! mysqldump \
    --host="${DB_HOST}" \
    --port="${DB_PORT}" \
    --user="${DB_USER}" \
    --password="${DB_PASSWORD}" \
    --single-transaction \
    --routines \
    --triggers \
    --events \
    --set-gtid-purged=OFF \
    "${DB_NAME}" | gzip > "${BACKUP_FILE}"; then
    error_exit "mysqldump failed"
fi

# Verify backup
log "Verifying backup..."
if ! gunzip -t "${BACKUP_FILE}"; then
    error_exit "Backup verification failed (corrupted gzip file)"
fi

BACKUP_SIZE=$(du -h "${BACKUP_FILE}" | cut -f1)
log "Backup completed successfully (size: ${BACKUP_SIZE})"

# Create monthly backup (on first day of month)
DAY_OF_MONTH=$(date +%d)
if [ "${DAY_OF_MONTH}" = "01" ]; then
    log "Creating monthly backup..."
    cp "${BACKUP_FILE}" "${MONTHLY_BACKUP_FILE}"
    log "Monthly backup created: ${MONTHLY_BACKUP_FILE}"
fi

# Upload to S3 if configured
if [ -n "${S3_BUCKET}" ]; then
    log "Uploading backup to S3..."
    if ! aws s3 cp "${BACKUP_FILE}" "s3://${S3_BUCKET}/backups/daily/$(basename ${BACKUP_FILE})"; then
        error_exit "S3 upload failed"
    fi
    log "Backup uploaded to S3 successfully"
    
    # Upload monthly backup to S3
    if [ "${DAY_OF_MONTH}" = "01" ]; then
        aws s3 cp "${MONTHLY_BACKUP_FILE}" "s3://${S3_BUCKET}/backups/monthly/$(basename ${MONTHLY_BACKUP_FILE})"
    fi
fi

# Clean up old daily backups (keep last 30 days)
log "Cleaning up old daily backups (retention: ${RETENTION_DAYS} days)..."
find "${BACKUP_DIR}/daily" -name "seer_backup_*.sql.gz" -type f -mtime +${RETENTION_DAYS} -delete
log "Old daily backups cleaned up"

# Clean up old monthly backups (keep last 12 months)
log "Cleaning up old monthly backups (retention: ${RETENTION_MONTHS} months)..."
find "${BACKUP_DIR}/monthly" -name "seer_backup_*.sql.gz" -type f -mtime +$((RETENTION_MONTHS * 30)) -delete
log "Old monthly backups cleaned up"

# Clean up old logs (keep last 90 days)
find "${BACKUP_DIR}/logs" -name "backup_*.log" -type f -mtime +90 -delete

log "Backup process completed successfully"

# Summary
log "=== Backup Summary ==="
log "Backup file: ${BACKUP_FILE}"
log "Backup size: ${BACKUP_SIZE}"
log "Daily backups: $(ls -1 ${BACKUP_DIR}/daily | wc -l)"
log "Monthly backups: $(ls -1 ${BACKUP_DIR}/monthly | wc -l)"
log "======================"

exit 0
