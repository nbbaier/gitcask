import type { WebhookPayload } from "../types.ts";

export async function fireWebhook(
  url: string | undefined,
  payload: WebhookPayload
): Promise<void> {
  if (!url) {
    return;
  }
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    // Best-effort: webhook failures are not retried
    console.error("Webhook delivery failed", {
      event: payload.event,
      job_id: payload.job_id,
      repo_id: payload.repo.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
