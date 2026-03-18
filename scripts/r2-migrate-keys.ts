/**
 * Bulk migrate R2 object keys from `git-backup/repos/...` to `repos/...`
 *
 * Usage:
 *   bun scripts/r2-migrate-keys.ts [--dry-run]
 *
 * Reads R2 credentials from .dev.vars.
 * Pass --dry-run to preview changes without modifying anything.
 */

// Bun auto-loads .env but not .dev.vars — load it manually
const devVars = Bun.file(".dev.vars");
if (await devVars.exists()) {
  for (const line of (await devVars.text()).split("\n")) {
    const match = line.match(/^(\w+)=(.+)$/);
    if (match) {
      process.env[match[1]] = match[2];
    }
  }
}

import {
  CopyObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";

const OLD_PREFIX = "git-backup/repos/";
const NEW_PREFIX = "repos/";
const BUCKET = "gitcask-backups";
const DRY_RUN = process.argv.includes("--dry-run");

const endpoint = process.env.R2_ENDPOINT?.replace(/\/git-backup\/?$/, "");
if (!endpoint) {
  console.error("R2_ENDPOINT not set (check .dev.vars)");
  process.exit(1);
}

const s3 = new S3Client({
  region: "auto",
  endpoint,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID ?? "",
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? "",
  },
});

async function listAllObjects(prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let continuationToken: string | undefined;

  do {
    const res = await s3.send(
      new ListObjectsV2Command({
        Bucket: BUCKET,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      })
    );
    for (const obj of res.Contents ?? []) {
      if (obj.Key) {
        keys.push(obj.Key);
      }
    }
    continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (continuationToken);

  return keys;
}

async function migrateKey(oldKey: string): Promise<void> {
  const newKey = oldKey.replace(OLD_PREFIX, NEW_PREFIX);

  if (DRY_RUN) {
    console.log(`[dry-run] ${oldKey} -> ${newKey}`);
    return;
  }

  // Copy to new key
  await s3.send(
    new CopyObjectCommand({
      Bucket: BUCKET,
      CopySource: `${BUCKET}/${oldKey}`,
      Key: newKey,
    })
  );

  // Delete old key
  await s3.send(
    new DeleteObjectCommand({
      Bucket: BUCKET,
      Key: oldKey,
    })
  );

  console.log(`Migrated: ${oldKey} -> ${newKey}`);
}

// Main
const keys = await listAllObjects(OLD_PREFIX);
console.log(
  `Found ${keys.length} objects under "${OLD_PREFIX}"${DRY_RUN ? " (dry run)" : ""}\n`
);

if (keys.length === 0) {
  console.log("Nothing to migrate.");
  process.exit(0);
}

let success = 0;
let failed = 0;

for (const key of keys) {
  try {
    await migrateKey(key);
    success++;
  } catch (err) {
    failed++;
    console.error(`Failed: ${key}`, err instanceof Error ? err.message : err);
  }
}

console.log(`\nDone. ${success} migrated, ${failed} failed.`);
