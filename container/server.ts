import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
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
  progress_url: string;
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

      console.log("[container] backup request received", {
        job_id: payload.job_id,
        repo: `${payload.owner}/${payload.repo}`,
      });

      // Return 202 immediately, process async
      const response = Response.json({ accepted: true }, { status: 202 });

      // Process backup in background
      processBackup(payload).catch((err) => {
        console.error("[container] background backup failed:", err);
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
    progress_url,
    callback_token,
  } = payload;

  let workDir: string | undefined;

  try {
    workDir = await mkdtemp(join(tmpdir(), "gitcask-"));
    const mirrorDir = join(workDir, `${repo}.git`);
    const tarPath = join(workDir, `${repo}.tar.gz`);

    console.log("[container] starting backup", {
      job_id,
      repo: `${owner}/${repo}`,
      progress_url,
      callback_url,
    });

    // 1. git clone --mirror
    await reportProgress(progress_url, callback_token, "cloning");
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
      const sanitizedStderr = stderr.replaceAll(pat, "***");
      throw new Error(
        `git clone failed (exit ${cloneExit}): ${sanitizedStderr}`
      );
    }

    // 2. tar czf
    await reportProgress(progress_url, callback_token, "archiving");
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
    await reportProgress(progress_url, callback_token, "hashing");
    const tarFile = Bun.file(tarPath);
    const tarBuffer = await tarFile.arrayBuffer();
    const tarData = new Uint8Array(tarBuffer);
    const sha256 = createHash("sha256").update(tarData).digest("hex");
    const sizeBytes = tarFile.size;

    // 4. Upload to R2
    await reportProgress(progress_url, callback_token, "uploading");
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
    await reportProgress(progress_url, callback_token, "fetching_metadata");
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
    await reportProgress(progress_url, callback_token, "uploading_metadata");
    const metadataKey = objectKey.replace(".tar.gz", "_metadata.json");
    await s3.send(
      new PutObjectCommand({
        Bucket: r2_credentials.bucket,
        Key: metadataKey,
        Body: JSON.stringify(metadata, null, 2),
        ContentType: "application/json",
      })
    );

    console.log("[container] backup complete, sending callback", {
      job_id,
      object_key: objectKey,
      sha256,
      size_bytes: sizeBytes,
    });

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

async function reportProgress(
  url: string,
  token: string,
  stage: string
): Promise<void> {
  try {
    console.log(`[container] reporting stage: ${stage}`);
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ stage }),
    });
    if (!res.ok) {
      console.error("[container] progress report rejected", {
        stage,
        status: res.status,
        body: await res.text(),
      });
    }
  } catch (err) {
    // Progress reporting is best-effort; don't fail the backup
    console.error(
      `[container] progress report failed for stage "${stage}":`,
      err
    );
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
