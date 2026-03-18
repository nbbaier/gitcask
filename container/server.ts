import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

interface BackupRequest {
  callback_token: string;
  callback_url: string;
  job_id: string;
  object_key_prefix: string;
  owner: string;
  pat: string;
  r2_credentials: {
    access_key_id: string;
    secret_access_key: string;
    endpoint: string;
    bucket: string;
  };
  repo: string;
}

const server = Bun.serve({
  port: 8788,
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === "/health" && req.method === "GET") {
      return Response.json({ status: "ok" });
    }

    if (url.pathname === "/backup" && req.method === "POST") {
      const payload = (await req.json()) as BackupRequest;

      // Return 202 immediately, process async
      const response = Response.json({ accepted: true }, { status: 202 });

      // Process backup in background
      processBackup(payload).catch((err) => {
        console.error("Background backup failed:", err);
      });

      return response;
    }

    return Response.json({ error: "Not found" }, { status: 404 });
  },
});

console.log(`Container service listening on port ${server.port}`);

async function processBackup(payload: BackupRequest): Promise<void> {
  const {
    job_id,
    owner,
    repo,
    pat,
    r2_credentials,
    object_key_prefix,
    callback_url,
    callback_token,
  } = payload;

  let workDir: string | undefined;

  try {
    workDir = await mkdtemp(join(tmpdir(), "gitcask-"));
    const mirrorDir = join(workDir, `${repo}.git`);
    const tarPath = join(workDir, `${repo}.tar.gz`);

    // 1. git clone --mirror
    const cloneUrl = `https://x-access-token:${pat}@github.com/${owner}/${repo}.git`;
    const cloneProc = Bun.spawn(
      ["git", "clone", "--mirror", cloneUrl, mirrorDir],
      {
        cwd: workDir,
        stderr: "pipe",
      }
    );
    const cloneExit = await cloneProc.exited;
    if (cloneExit !== 0) {
      const stderr = await new Response(cloneProc.stderr).text();
      throw new Error(`git clone failed (exit ${cloneExit}): ${stderr}`);
    }

    // 2. tar czf
    const tarProc = Bun.spawn(
      ["tar", "czf", tarPath, "-C", workDir, `${repo}.git`],
      {
        cwd: workDir,
        stderr: "pipe",
      }
    );
    const tarExit = await tarProc.exited;
    if (tarExit !== 0) {
      throw new Error(`tar failed (exit ${tarExit})`);
    }

    // 3. Compute SHA-256
    const tarData = await readFile(tarPath);
    const sha256 = createHash("sha256").update(tarData).digest("hex");
    const sizeBytes = tarData.length;

    // 4. Upload to R2
    const s3 = new S3Client({
      region: "auto",
      endpoint: r2_credentials.endpoint,
      credentials: {
        accessKeyId: r2_credentials.access_key_id,
        secretAccessKey: r2_credentials.secret_access_key,
      },
    });

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const objectKey = `${object_key_prefix}${timestamp}_${job_id}.tar.gz`;

    await s3.send(
      new PutObjectCommand({
        Bucket: r2_credentials.bucket,
        Key: objectKey,
        Body: tarData,
        ChecksumSHA256: Buffer.from(sha256, "hex").toString("base64"),
        ContentType: "application/gzip",
      })
    );

    // 5. Fetch GitHub metadata
    const metaRes = await fetch(
      `https://api.github.com/repos/${owner}/${repo}`,
      {
        headers: {
          Authorization: `Bearer ${pat}`,
          "User-Agent": "gitcask/1.0",
          Accept: "application/vnd.github+json",
        },
      }
    );

    let metadata: Record<string, unknown> = {};
    if (metaRes.ok) {
      const ghData = (await metaRes.json()) as Record<string, unknown>;
      metadata = {
        description: ghData.description,
        topics: ghData.topics,
        visibility: ghData.visibility,
        default_branch: ghData.default_branch,
        language: ghData.language,
        fetched_at: new Date().toISOString(),
      };
    }

    // 6. Upload metadata.json
    const metadataKey = objectKey.replace(".tar.gz", "_metadata.json");
    await s3.send(
      new PutObjectCommand({
        Bucket: r2_credentials.bucket,
        Key: metadataKey,
        Body: JSON.stringify(metadata, null, 2),
        ContentType: "application/json",
      })
    );

    // 7. Callback to worker with success
    await sendCallback(callback_url, callback_token, {
      job_id,
      success: true,
      sha256,
      size_bytes: sizeBytes,
      object_key: objectKey,
      metadata_key: metadataKey,
    });
  } catch (err) {
    console.error(`Backup failed for ${owner}/${repo}:`, err);
    // Callback with failure
    await sendCallback(callback_url, callback_token, {
      job_id,
      success: false,
      error: err instanceof Error ? err.message : String(err),
    });
  } finally {
    // Cleanup temp directory
    if (workDir) {
      // biome-ignore lint: ignore error when removing temp directory
      await rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

async function sendCallback(
  url: string,
  token: string,
  payload: Record<string, unknown>
): Promise<void> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      console.error(`Callback failed: ${res.status} ${await res.text()}`);
    }
  } catch (err) {
    console.error("Callback request failed:", err);
  }
}
