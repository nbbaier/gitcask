export interface Env {
  ADMIN_TOKEN: string;
  BUCKET: R2Bucket;
  CONTAINER: DurableObjectNamespace;
  DB: D1Database;
  GITHUB_PAT: string;
  JOB_QUEUE: Queue;
  R2_ACCESS_KEY_ID?: string;
  R2_ENDPOINT?: string;
  R2_SECRET_ACCESS_KEY?: string;
  WEBHOOK_URL?: string;
  WORKER_URL: string;
}

export interface QueueMessage {
  attempt: number;
  idempotency_key: string;
  job_id: string;
  repo_id: string;
  trigger_source: "schedule" | "manual";
}

export interface ContainerRequest {
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

export interface ContainerCallbackPayload {
  error?: string;
  job_id: string;
  metadata_key?: string;
  object_key?: string;
  sha256?: string;
  size_bytes?: number;
  success: boolean;
}

export interface WebhookPayload {
  attempts: number;
  error: string;
  event: "backup.failed";
  job_id: string;
  repo: { id: string; owner: string; name: string };
  timestamp: string;
}
