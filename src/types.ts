export interface Env {
  DB: D1Database;
  BUCKET: R2Bucket;
  JOB_QUEUE: Queue;
  ADMIN_TOKEN: string;
  GITHUB_PAT: string;
  CONTAINER_URL: string;
  WEBHOOK_URL?: string;
  WORKER_URL?: string;
}

export interface QueueMessage {
  job_id: string;
  repo_id: string;
  idempotency_key: string;
  attempt: number;
  trigger_source: "schedule" | "manual";
}

export interface ContainerRequest {
  job_id: string;
  owner: string;
  repo: string;
  pat: string;
  r2_credentials: {
    access_key_id: string;
    secret_access_key: string;
    endpoint: string;
    bucket: string;
  };
  object_key_prefix: string;
  callback_url: string;
  callback_token: string;
}

export interface ContainerCallbackPayload {
  job_id: string;
  success: boolean;
  sha256?: string;
  size_bytes?: number;
  object_key?: string;
  metadata_key?: string;
  error?: string;
}

export interface WebhookPayload {
  event: "backup.failed";
  repo: { id: string; owner: string; name: string };
  job_id: string;
  attempts: number;
  error: string;
  timestamp: string;
}
