import { DurableObject } from "cloudflare:workers";
import type { Env } from "./types.ts";

export class BackupContainer extends DurableObject<Env> {
  override async fetch(request: Request): Promise<Response> {
    if (this.ctx.container && !this.ctx.container.running) {
      this.ctx.container.start({ enableInternet: true });
      await this.ctx.container.monitor();
    }

    if (!this.ctx.container) {
      return new Response("Container not available", { status: 503 });
    }

    return this.ctx.container.getTcpPort(8788).fetch(request);
  }
}
