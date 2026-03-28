/// <reference types="@cloudflare/vitest-pool-workers/types" />

declare namespace Cloudflare {
  interface Env {
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
}
