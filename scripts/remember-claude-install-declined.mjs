#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

function parseArgs(argv) {
  const result = {
    workspace: process.cwd(),
    reason: "User declined Claude CLI installation/configuration.",
  };
  const aliases = {
    "-Workspace": "workspace",
    "--workspace": "workspace",
    "-Reason": "reason",
    "--reason": "reason",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const key = aliases[argv[index]];
    if (!key) {
      throw new Error(`Unknown argument: ${argv[index]}`);
    }
    if (index + 1 >= argv.length) {
      throw new Error(`Missing value for ${argv[index]}`);
    }
    result[key] = argv[index + 1];
    index += 1;
  }
  return result;
}

const options = parseArgs(process.argv.slice(2));
const workspacePath = resolve(options.workspace);
const stateRoot = join(workspacePath, ".codex-ask-claude", "state");
const markerPath = join(stateRoot, "claude-install-declined.json");

await mkdir(stateRoot, { recursive: true });
await writeFile(
  markerPath,
  `${JSON.stringify(
    {
      declined: true,
      reason: options.reason,
      recordedAt: new Date().toISOString(),
    },
    null,
    2,
  )}\n`,
  "utf8",
);

process.stdout.write(`${JSON.stringify({ success: true, markerPath })}\n`);
