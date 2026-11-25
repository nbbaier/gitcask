import { defineCommand } from "citty";
import { getClient, output } from "../config.ts";
import { formatJobDetail, formatJobs } from "../format.ts";

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
        output(jobs, formatJobs);
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
        output(job, formatJobDetail);
      },
    }),

    cancel: defineCommand({
      meta: { name: "cancel", description: "Cancel a queued or running job" },
      args: {
        jobId: {
          type: "positional",
          description: "Job ID",
          required: true,
        },
      },
      run: async ({ args }) => {
        const client = getClient();
        const result = await client.cancelJob(args.jobId);
        console.log(`Cancelled job ${result.job_id}`);
      },
    }),
  },
});
