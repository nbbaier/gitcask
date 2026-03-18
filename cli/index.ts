#!/usr/bin/env bun
import { defineCommand, runMain } from "citty";
import { healthCommand } from "./commands/health.ts";
import { reposCommand } from "./commands/repos.ts";
import { runsCommand } from "./commands/runs.ts";
import { resolveConfig } from "./config.ts";

const main = defineCommand({
  meta: {
    name: "gitcask",
    description: "GitCask CLI - manage GitHub repo backups",
  },
  args: {
    url: {
      type: "string",
      description: "API base URL (or set GITCASK_URL)",
    },
    token: {
      type: "string",
      description: "API auth token (or set GITCASK_TOKEN)",
    },
    json: {
      type: "boolean",
      description: "Output as JSON",
      default: false,
    },
  },
  setup: ({ args }) => {
    resolveConfig(args);
  },
  subCommands: {
    health: healthCommand,
    repos: reposCommand,
    runs: runsCommand,
  },
});

runMain(main);
