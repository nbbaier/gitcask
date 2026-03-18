import { defineCommand } from "citty";
import { getClient, isJson } from "../config.ts";
import { formatJson, formatRepos } from "../format.ts";

export const reposCommand = defineCommand({
  meta: { name: "repos", description: "Manage repos" },
  subCommands: {
    list: defineCommand({
      meta: { name: "list", description: "List repos" },
      args: {
        enabled: {
          type: "string",
          description: "Filter by enabled status (true/false)",
        },
      },
      run: async ({ args }) => {
        const client = getClient();
        const enabled =
          args.enabled === undefined ? undefined : args.enabled === "true";
        const repos = await client.listRepos(enabled);
        console.log(isJson() ? formatJson(repos) : formatRepos(repos));
      },
    }),

    add: defineCommand({
      meta: { name: "add", description: "Add a repo" },
      args: {
        repo: {
          type: "positional",
          description: "owner/name",
          required: true,
        },
        interval: {
          type: "string",
          description: "Backup interval in minutes",
        },
      },
      run: async ({ args }) => {
        const client = getClient();
        const parts = args.repo.split("/");
        if (parts.length !== 2 || !parts[0] || !parts[1]) {
          console.error("Error: repo must be in owner/name format");
          process.exit(1);
        }
        const [owner, name] = parts;
        const interval = args.interval
          ? Number.parseInt(args.interval, 10)
          : undefined;
        const repo = await client.addRepo(owner, name, interval);
        if (isJson()) {
          console.log(formatJson(repo));
        } else {
          console.log(`Added repo ${owner}/${name} (id: ${repo.id})`);
        }
      },
    }),

    update: defineCommand({
      meta: { name: "update", description: "Update a repo" },
      args: {
        id: {
          type: "positional",
          description: "Repo ID",
          required: true,
        },
        interval: {
          type: "string",
          description: "New interval in minutes",
        },
        enabled: {
          type: "string",
          description: "Enable or disable (true/false)",
        },
      },
      run: async ({ args }) => {
        const client = getClient();
        const updates: { interval_minutes?: number; enabled?: boolean } = {};
        if (args.interval !== undefined) {
          updates.interval_minutes = Number.parseInt(args.interval, 10);
        }
        if (args.enabled !== undefined) {
          updates.enabled = args.enabled === "true";
        }
        const repo = await client.updateRepo(args.id, updates);
        if (isJson()) {
          console.log(formatJson(repo));
        } else {
          console.log(`Updated repo ${repo.owner}/${repo.name}`);
        }
      },
    }),

    delete: defineCommand({
      meta: { name: "delete", description: "Delete a repo" },
      args: {
        id: {
          type: "positional",
          description: "Repo ID",
          required: true,
        },
        yes: {
          type: "boolean",
          description: "Skip confirmation",
          default: false,
        },
      },
      run: async ({ args }) => {
        const client = getClient();
        if (!args.yes) {
          process.stdout.write(
            `Delete repo ${args.id}? This cannot be undone. [y/N] `
          );
          const response = await new Promise<string>((resolve) => {
            process.stdin.once("data", (data) =>
              resolve(data.toString().trim())
            );
          });
          if (response.toLowerCase() !== "y") {
            console.log("Aborted.");
            return;
          }
        }
        await client.deleteRepo(args.id);
        if (isJson()) {
          console.log(formatJson({ deleted: true, id: args.id }));
        } else {
          console.log(`Deleted repo ${args.id}`);
        }
      },
    }),

    trigger: defineCommand({
      meta: { name: "trigger", description: "Trigger a backup" },
      args: {
        id: {
          type: "positional",
          description: "Repo ID",
          required: true,
        },
      },
      run: async ({ args }) => {
        const client = getClient();
        const result = await client.triggerBackup(args.id);
        if (isJson()) {
          console.log(formatJson(result));
        } else {
          console.log(
            `Triggered backup for ${args.id} (job: ${result.job_id})`
          );
        }
      },
    }),
  },
});
