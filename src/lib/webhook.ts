import type { WebhookPayload } from "../types.ts";

export async function fireWebhook(
  url: string | undefined,
  payload: WebhookPayload,
): Promise<void> {
  if (!url) return;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    // Best-effort: webhook failures are not retried
    console.error("Webhook delivery failed", { url, payload });
  }
}
