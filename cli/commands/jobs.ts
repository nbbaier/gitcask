import { defineCommand } from "citty";
import { getClient, isJson } from "../config.ts";
import { formatJobDetail, formatJobs, formatJson } from "../format.ts";

export const jobsCommand = defineCommand({
  meta: { name: "jobs", description: "View active jobs" },
  subCommands: {
    list: defineCommand({
      meta: { name: "list", description: "List active (queued/running) jobs" },
      args: {
        repoId: {
          type: "string",
          description: "Filter by repo ID",
        },
      },
      run: async ({ args }) => {
        const client = getClient();
        const jobs = await client.listJobs(args.repoId || undefined);
        console.log(isJson() ? formatJson(jobs) : formatJobs(jobs));
      },
    }),

    get: defineCommand({
      meta: { name: "get", description: "Get job details" },
      args: {
        jobId: {
          type: "positional",
          description: "Job ID",
          required: true,
        },
      },
      run: async ({ args }) => {
        const client = getClient();
        const job = await client.getJob(args.jobId);
        console.log(isJson() ? formatJson(job) : formatJobDetail(job));
      },
    }),
  },
});
