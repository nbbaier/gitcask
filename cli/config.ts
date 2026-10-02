import type { Client } from "./client.ts";
import { createClient } from "./client.ts";

let _client: Client | undefined;
let _json = false;

export function resolveConfig(args: {
  url?: string;
  token?: string;
  json: boolean;
}) {
  const url = args.url ?? process.env.GITCASK_URL;
  const token = args.token ?? process.env.GITCASK_TOKEN;

  if (!url) {
    console.error("Error: API URL required. Use --url or set GITCASK_URL.");
    process.exit(1);
  }
  if (!token) {
    console.error(
      "Error: API token required. Use --token or set GITCASK_TOKEN."
    );
    process.exit(1);
  }

  _client = createClient({ url, token });
  _json = args.json;
}

export function getClient(): Client {
  if (!_client) {
    console.error("Error: config not resolved. This is a bug.");
    process.exit(1);
  }
  return _client;
}

// Prints `data` as pretty JSON under --json, otherwise via `formatHuman`.
export function output<T>(data: T, formatHuman: (data: T) => string): void {
  console.log(_json ? JSON.stringify(data, null, 2) : formatHuman(data));
}
