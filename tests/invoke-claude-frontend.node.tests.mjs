#!/usr/bin/env node
import { mkdtemp, mkdir, writeFile, readFile, rm, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

const repoRoot = resolve(import.meta.dirname, "..");
const tmpRoot = await mkdtemp(join(tmpdir(), "codex-ask-claude-node-test-"));
const workspace = join(tmpRoot, "workspace");
const bin = join(tmpRoot, "bin");

function run(command, args) {
  return new Promise((resolveRun) => {
    const child = spawn(command, args, { cwd: repoRoot, shell: false });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("close", (code) => resolveRun({ code, stdout, stderr }));
  });
}

try {
  await mkdir(workspace, { recursive: true });
  await mkdir(bin, { recursive: true });

  const fakeClaude = process.platform === "win32" ? join(bin, "claude.cmd") : join(bin, "claude");
  if (process.platform === "win32") {
    await writeFile(
      fakeClaude,
      [
        "@echo off",
        "echo NODE_FAKE_STDOUT:%*",
        "powershell -NoProfile -Command \"Start-Sleep -Milliseconds 300\"",
        "echo NODE_FAKE_STDERR 1>&2",
        "exit /b 0",
        "",
      ].join("\r\n"),
      "ascii",
    );
  } else {
    await writeFile(
      fakeClaude,
      [
        "#!/usr/bin/env sh",
        "printf 'NODE_FAKE_STDOUT:%s\\n' \"$*\"",
        "sleep 0.3",
        "printf 'NODE_FAKE_STDERR\\n' >&2",
        "exit 0",
        "",
      ].join("\n"),
      "utf8",
    );
    await chmod(fakeClaude, 0o755);
  }

  const result = await run(process.execPath, [
    join(repoRoot, "scripts", "invoke-claude-frontend.mjs"),
    "--workspace",
    workspace,
    "--claude-path",
    fakeClaude,
    "--artifact-dir",
    ".omx/test-artifacts",
    "--model",
    "sonnet",
    "--fallback-model",
    "opus",
    "--effort",
    "medium",
    "--heartbeat-seconds",
    "1",
    "--prompt",
    "Build a responsive pricing table",
  ]);

  if (result.code !== 0) {
    throw new Error(`Expected wrapper exit code 0, got ${result.code}\n${result.stderr}\n${result.stdout}`);
  }

  if (!result.stdout.includes("[stdout] NODE_FAKE_STDOUT")) {
    throw new Error("Expected live stdout line to be visible.");
  }
  if (!result.stdout.includes("[stderr] NODE_FAKE_STDERR")) {
    throw new Error("Expected live stderr line to be visible.");
  }

  const jsonLine = result.stdout
    .trim()
    .split(/\r?\n/)
    .filter((line) => line.startsWith("{"))
    .at(-1);
  const parsed = JSON.parse(jsonLine);
  if (!parsed.success || parsed.model !== "sonnet" || parsed.fallbackModel !== "opus" || parsed.effort !== "medium") {
    throw new Error(`Unexpected result JSON: ${jsonLine}`);
  }

  const artifact = await readFile(parsed.artifactPath, "utf8");
  const log = await readFile(parsed.logPath, "utf8");
  if (!artifact.includes("NODE_FAKE_STDOUT") || !artifact.includes("NODE_FAKE_STDERR")) {
    throw new Error("Expected artifact to include stdout and stderr.");
  }
  if (!log.includes("[stdout] NODE_FAKE_STDOUT") || !log.includes("[stderr] NODE_FAKE_STDERR")) {
    throw new Error("Expected log to include tagged stdout and stderr.");
  }

  const missing = await run(process.execPath, [
    join(repoRoot, "scripts", "invoke-claude-frontend.mjs"),
    "--workspace",
    workspace,
    "--claude-path",
    join(bin, "missing-claude"),
    "--artifact-dir",
    ".omx/test-artifacts",
    "--no-live-output",
    "--prompt",
    "Build a responsive pricing table",
  ]);
  const missingLine = missing.stdout
    .trim()
    .split(/\r?\n/)
    .filter((line) => line.startsWith("{"))
    .at(-1);
  const missingParsed = JSON.parse(missingLine);
  if (!missingParsed.needsClaudeInstall) {
    throw new Error("Expected missing Claude to set needsClaudeInstall=true.");
  }

  const remember = await run(process.execPath, [
    join(repoRoot, "scripts", "remember-claude-install-declined.mjs"),
    "--workspace",
    workspace,
    "--reason",
    "test decline",
  ]);
  if (remember.code !== 0) {
    throw new Error(`Expected remember script exit code 0, got ${remember.code}`);
  }
  const rememberParsed = JSON.parse(remember.stdout.trim());
  const marker = await readFile(rememberParsed.markerPath, "utf8");
  if (!marker.includes("test decline")) {
    throw new Error("Expected decline marker to include reason.");
  }

  console.log("PASS invoke-claude-frontend-node");
} finally {
  await rm(tmpRoot, { recursive: true, force: true });
}
