import { defineCommand } from "citty";
import { getClient, isJson } from "../config.ts";
import { formatJson } from "../format.ts";

export const healthCommand = defineCommand({
  meta: { name: "health", description: "Check API health" },
  run: async () => {
    const client = getClient();
    const result = await client.health();
    if (isJson()) {
      console.log(formatJson(result));
    } else {
      console.log(`Status: ${result.status}`);
      for (const [service, status] of Object.entries(result.checks)) {
        console.log(`  ${service}: ${status}`);
      }
    }
  },
});
