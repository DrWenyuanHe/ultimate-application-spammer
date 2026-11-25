# Storage and backups

All storage and backup actions are operations (`AGENTS.md` section 4); run `op describe` before first use.

Use this when the person asks how much space the workspace uses, wants to clean up, back up or restore their data, or keep a second copy of backups somewhere else. Also use it when a command says the database is missing but backups exist.

Nothing here deletes anything. Tidying moves items into `Archive/Clearable/`; only the person deletes, by hand, if they want the space back. There is no delete button.

## How backups work

- Each time the dashboard starts, if the newest snapshot is more than a day old, the app takes a snapshot of the database into `app/data/backups/`. Updates and restores also take one first. If the person rarely opens the dashboard, run `backup.now` after a big piece of work.
- It keeps the newest snapshot of each of the last 14 days and each of the last 12 months, plus the three newest. Older snapshots are moved to `Archive/Clearable/Old backups/`.
- Backups made by updates and rollbacks are saved in `Archive/` instead (named `… before vX.Y.Z database.sqlite`) and do not appear in `backup.list`.
- Optionally, each snapshot in `app/data/backups/` is also copied to a second folder the person chooses (a mirror), such as a USB drive or a synced folder.
- If the database file goes missing while backups exist, the app refuses to start with an empty one. Restore instead (below).

## Show storage use

```
node app/cli.mjs op run storage.report
```

Explain each line in plain words, using its `status`: essential items (database, backups, saved document versions, submitted applications, career library, templates), items the app can regenerate, clearable items, and what is already in `Archive/Clearable/`.

## Tidy up

1. Always start with the dry run:

   ```
   node app/cli.mjs op run storage.tidy
   ```

   It lists what could be moved, with a reason and size for each: PDF conversion work files, previews, dashboard logs older than 14 days, raw job-board results and research claim files older than 30 days, review notes, and drafts for jobs submitted more than 30 days ago (the filed copy stays in `1 Applications/`).

2. Show the person the list and the total size. Tidying also moves backups that fall outside the retention window. If the list includes a draft folder for a job that is still active, do not apply; tell the person, since tidying moves everything on the list. Otherwise ask: "Shall I move these into `Archive/Clearable`? (yes/no)"
3. Only after a yes, run `storage.tidy` with the input `{ "apply": true }`:

   ```
   node app/cli.mjs op run storage.tidy --file app/data/tmp/tidy-apply-1.json
   ```

4. Tell them: "Everything is now in `Archive/Clearable`, sorted by type. Delete that folder yourself whenever you want the space back."

Never clearable, and never to be moved by tidying: the database, its recent backups, saved document versions in `app/data/files/`, submitted application folders in `1 Applications/`, the career library documents in `2 Career Library/`, and templates.

## Back up now

```
node app/cli.mjs op run backup.now
node app/cli.mjs op run backup.list
```

`backup.now` reports the new snapshot's file, and the mirror copy if one is set. `backup.list` shows all snapshots, newest first.

For a complete backup of everything (documents too), tell the person to copy the whole workspace folder to a drive or cloud folder they trust. A cloud folder means their private files are stored with that provider.

## Keep a second copy of backups (mirror)

Run `backup.mirror` with `{ "folder": "D:/Job search backups" }` to turn it on, or `{ "folder": null }` to turn it off.

Use a folder the person names. Mention that a synced cloud folder (OneDrive, iCloud Drive, Dropbox, Google Drive) stores the backups with that provider. If a snapshot result shows `mirrorError`, tell the person the mirror folder could not be written (for example, the drive is unplugged).

## Restore a backup

1. Run `backup.list` and help the person choose one by date. If it fails because the database is missing, list the `.sqlite` files in `app/data/backups/` and in `Archive/` instead.
2. Explain: "This replaces your current data with the snapshot from <date>. Your current data is saved as a new snapshot first, and the old files are moved to `Archive/`, so this can be undone. Changes made after <date> won't appear. Go ahead? (yes/no)"
3. Only after a yes, close the dashboard with `node app/cli.mjs stop`, then run `backup.restore` with `{ "file": "FILE FROM backup.list" }`:

   ```
   node app/cli.mjs op run backup.restore --file app/data/tmp/restore-1.json
   ```

4. If it still says to close the dashboard, run `node app/cli.mjs stop` again and retry. If that does not help, ask the person to restart their computer.
5. Report `restored` and `previous` (the snapshot of the data they had just before), then run `node app/cli.mjs doctor --brief` and `node app/cli.mjs start` if they want the dashboard.

To undo a restore, restore the `previous` snapshot the same way.
