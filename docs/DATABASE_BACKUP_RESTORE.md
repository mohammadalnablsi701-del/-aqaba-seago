# Aqaba SeaGo — Database Backup & Restore Runbook

This runbook covers the application-level BSON backup/restore tooling included in the repository.

> Important: this tooling is an additional recovery layer. It does **not** replace provider-native automated snapshots/backups. Production provider backups and retention must still be enabled and verified separately.

## What is preserved

The backup archive preserves:

- BSON document types such as ObjectId, Date, Decimal128 and nested BSON values.
- All non-system collections, including empty collections.
- Collection documents.
- Collection indexes other than MongoDB's built-in `_id_` index, which MongoDB recreates automatically.

Backups are gzip-compressed and written with owner-only file permissions where supported.

The local `backups/` directory is excluded from Git and must never be committed.

## Create a backup

Required environment variables:

- `MONGODB_URI`: source MongoDB connection string.
- `DB_BACKUP_DATABASE`: exact source database name.

Optional:

- `DB_BACKUP_PATH`: output path. If omitted, a timestamped file is written below `backups/`.

Command:

```bash
npm run db:backup
```

The command prints metadata only. It does not print the MongoDB URI or database credentials.

### Production backup handling

When backing up production:

1. Run from a trusted operator environment only.
2. Store the generated archive in encrypted storage with restricted access.
3. Do not email or upload the archive to public file sharing.
4. Delete temporary local copies after the encrypted copy is verified.
5. Record the backup timestamp and operator in the incident/change log.

## Restore safety model

Restore is intentionally harder than backup.

It requires **all** of the following:

- `RESTORE_MONGODB_URI`: a separate restore target connection string.
- `RESTORE_DATABASE`: exact target database name.
- `DB_BACKUP_PATH`: archive to restore.
- `ALLOW_DB_RESTORE=true`.
- `RESTORE_CONFIRM_DATABASE`: must exactly equal `RESTORE_DATABASE`.
- `NODE_ENV` must **not** be `production`.
- `PUBLIC_LAUNCH` must **not** be `true`.
- Target database name must differ from the source database name stored in the backup.

Command:

```bash
npm run db:restore
```

Existing collections with matching names in the target database are dropped and recreated. This is why restore must only target a disposable/non-production database unless an incident runbook explicitly authorizes a controlled recovery.

## Restore drill procedure

Use this for a routine recovery test:

1. Create or choose a non-production MongoDB instance/database.
2. Set `RESTORE_DATABASE` to a unique name such as `seago_restore_test_YYYYMMDD`.
3. Set `RESTORE_CONFIRM_DATABASE` to the exact same value.
4. Set `ALLOW_DB_RESTORE=true`, `NODE_ENV=test`, and `PUBLIC_LAUNCH=false`.
5. Run `npm run db:restore`.
6. Verify:
   - collection count,
   - booking/payment/ticket document counts,
   - a sample booking can be queried,
   - important indexes exist,
   - ObjectId/Date/Decimal fields retain their BSON types.
7. Drop the restore-test database after validation.
8. Record the drill date and result.

## Automated restore validation

CI runs `test/database-backup-restore.integration.test.js` against a disposable MongoDB replica set. The test:

- creates a source database,
- writes BSON values and an index,
- creates a compressed backup,
- restores it to a different temporary database,
- verifies document values and BSON types,
- verifies the custom index,
- verifies an empty collection survives,
- verifies production/same-database restore guards,
- removes both temporary databases afterward.

This proves the application-level backup format can round-trip successfully without touching staging or production data.

## Provider-native production backups still required

Before public launch, confirm the actual production MongoDB provider has:

- automated backups/snapshots enabled,
- documented retention period,
- restore-to-new-cluster/database capability,
- encryption at rest,
- access restricted to the minimum required operators/service account,
- at least one restore test performed from a provider-native backup.

Do not mark provider-native backup coverage complete until those settings are verified in the provider console or API.
