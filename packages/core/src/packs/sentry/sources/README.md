Snapshots of the public pages the Sentry pack's behavior records (`../records.json`) quote, byte
for byte as read: the contract test checks each record's quote is in its snapshot and that the
snapshot matches the record's sha256. Update a record by reading the page again, replacing the
snapshot and its sha256, and checking the quote still holds.

- `MIGRATION-11.7.0.md.txt`: the Sentry JavaScript SDK migration guide,
  https://github.com/getsentry/sentry-javascript/blob/11.7.0/MIGRATION.md, read 2026-10-19.
  MIT License, Copyright (c) 2012 Functional Software, Inc. dba Sentry.
