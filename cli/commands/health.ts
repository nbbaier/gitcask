import { defineCommand } from "citty";
import { getClient, output } from "../config.ts";

export const healthCommand = defineCommand({
  meta: { name: "health", description: "Check API health" },
  run: async () => {
    const client = getClient();
    const result = await client.health();
    output(result, ({ status, checks }) =>
      [
        `Status: ${status}`,
        ...Object.entries(checks).map(
          ([service, check]) => `  ${service}: ${check}`
        ),
      ].join("\n")
    );
  },
});
