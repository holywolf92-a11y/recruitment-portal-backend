# WhatsApp Historical PDF Import Usage

## Purpose

This importer is for one-time historical recovery of likely CV PDF files from exported WhatsApp data.

It is designed to avoid using the live production WhatsApp session for old-history traversal.

## Supported Manifest Inputs

The `--manifest` argument supports three input types:

- `.json`
- `.csv`
- `.zip`

For ZIP imports, the ZIP must contain:

- a `manifest.json` or `manifest.csv` file
- the referenced PDF files

## Required Manifest Fields

Each manifest row or object must contain:

- `chatId`
- `senderNumber`
- `messageTimestamp`
- `localFilePath`

Optional fields:

- `messageId`
- `originalFilename`
- `mimeType`

## JSON Example

See [test-files/whatsapp-backfill/manifest.example.json](../test-files/whatsapp-backfill/manifest.example.json).

## CSV Example

See [test-files/whatsapp-backfill/manifest.example.csv](../test-files/whatsapp-backfill/manifest.example.csv).

## ZIP Layout Example

```text
whatsapp-backfill-2024-q1.zip
  manifest.csv
  files/
    candidate-001-cv.pdf
    candidate-002-resume.pdf
```

Inside the manifest, `localFilePath` can be relative to the manifest file location, for example:

```csv
chatId,senderNumber,messageTimestamp,localFilePath,messageId,originalFilename,mimeType
923001112233@c.us,923001112233,2024-01-15T09:30:00.000Z,files/candidate-001-cv.pdf,wamid.abc123,candidate-001-cv.pdf,application/pdf
```

## Sample Commands

### Dry run with JSON manifest

```powershell
npm run backfill:whatsapp-pdf -- --manifest ./test-files/whatsapp-backfill/manifest.example.json --batch-id whatsapp-q1-2024 --start-date 2024-01-01T00:00:00Z --end-date 2024-03-31T23:59:59Z --dry-run --resume-from-checkpoint
```

### Real run with CSV manifest

```powershell
npm run backfill:whatsapp-pdf -- --manifest ./test-files/whatsapp-backfill/manifest.example.csv --batch-id whatsapp-q1-2024 --start-date 2024-01-01T00:00:00Z --end-date 2024-03-31T23:59:59Z --max-files 25 --max-chats 10 --throttle-ms-between-downloads 750 --stop-on-error-threshold 5 --resume-from-checkpoint
```

### Real run with ZIP package

```powershell
npm run backfill:whatsapp-pdf -- --manifest ./imports/whatsapp-backfill-2024-q1.zip --batch-id whatsapp-q1-2024 --start-date 2024-01-01T00:00:00Z --end-date 2024-03-31T23:59:59Z --max-files 25 --max-chats 10 --throttle-ms-between-downloads 750 --stop-on-error-threshold 5 --resume-from-checkpoint
```

## Recommended First Run

Always begin with:

- `--dry-run`
- a single 3-month window
- a small `--max-files`
- a small allowlist of chats if available

Example:

```powershell
npm run backfill:whatsapp-pdf -- --manifest ./imports/whatsapp-backfill-2024-q1.zip --batch-id whatsapp-q1-2024 --start-date 2024-01-01T00:00:00Z --end-date 2024-03-31T23:59:59Z --dry-run --max-files 10 --max-chats 5 --throttle-ms-between-downloads 1000 --stop-on-error-threshold 3 --resume-from-checkpoint
```

## Outputs

The importer writes:

- a checkpoint JSON file
- a review NDJSON report for uncertain PDFs
- normal backend logs

## Safety Notes

- This importer is for exported historical data only.
- It does not use the live production WhatsApp bridge for old-message traversal.
- It should be run in one small batch at a time.
- Re-run only from checkpoints, not by starting broad repeated scans.