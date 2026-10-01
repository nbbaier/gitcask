import { defineCommand } from "citty";
import { getClient, output } from "../config.ts";
import { formatRunDetail, formatRuns } from "../format.ts";

export const runsCommand = defineCommand({
  meta: { name: "runs", description: "View backup runs" },
  subCommands: {
    list: defineCommand({
      meta: { name: "list", description: "List runs for a repo" },
      args: {
        repoId: {
          type: "positional",
          description: "Repo ID",
          required: true,
        },
      },
      run: async ({ args }) => {
        const client = getClient();
        const runs = await client.listRuns(args.repoId);
        output(runs, formatRuns);
      },
    }),

    get: defineCommand({
      meta: { name: "get", description: "Get run details" },
      args: {
        runId: {
          type: "positional",
          description: "Run ID",
          required: true,
        },
      },
      run: async ({ args }) => {
        const client = getClient();
        const run = await client.getRun(args.runId);
        output(run, formatRunDetail);
      },
    }),
  },
});
