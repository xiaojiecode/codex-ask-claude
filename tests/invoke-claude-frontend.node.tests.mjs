#!/usr/bin/env node
import { mkdtemp, mkdir, writeFile, readFile, rm, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { spawn } from "node:child_process";

const repoRoot = resolve(import.meta.dirname, "..");
const tmpRoot = await mkdtemp(join(tmpdir(), "codex-ask-claude-node-test-"));
const workspace = join(tmpRoot, "workspace");
const bin = join(tmpRoot, "bin");

function run(command, args, options = {}) {
  return new Promise((resolveRun) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      shell: false,
      env: options.env ?? process.env,
    });
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
  const fakeClaudeJson = process.platform === "win32" ? join(bin, "claude-json.cmd") : join(bin, "claude-json");
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
    await writeFile(
      fakeClaudeJson,
      [
        "@echo off",
        "echo {\"type\":\"system\",\"subtype\":\"init\",\"cwd\":\"workspace\",\"model\":\"claude-sonnet-4-6\"}",
        "echo {\"type\":\"system\",\"subtype\":\"ready\"}",
        "echo {\"type\":\"assistant\",\"message\":{\"content\":[{\"type\":\"text\",\"text\":\"正在分析配置文件\"}]}}",
        "echo {\"type\":\"result\",\"result\":\"完成\",\"subtype\":\"end_turn\"}",
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
    await writeFile(
      fakeClaudeJson,
      [
        "#!/usr/bin/env sh",
        "printf '%s\\n' '{\"type\":\"system\",\"subtype\":\"init\",\"cwd\":\"workspace\",\"model\":\"claude-sonnet-4-6\"}'",
        "printf '%s\\n' '{\"type\":\"system\",\"subtype\":\"ready\"}'",
        "printf '%s\\n' '{\"type\":\"assistant\",\"message\":{\"content\":[{\"type\":\"text\",\"text\":\"正在分析配置文件\"}]}}'",
        "printf '%s\\n' '{\"type\":\"result\",\"result\":\"完成\",\"subtype\":\"end_turn\"}'",
        "exit 0",
        "",
      ].join("\n"),
      "utf8",
    );
    await chmod(fakeClaudeJson, 0o755);
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
    "--permission-mode",
    "acceptEdits",
    "--allowed-tools",
    "Read,Edit",
    "--disallowed-tools",
    "Bash(rm *)",
    "--add-dir",
    workspace,
    "--prompt",
    "Build a responsive pricing table",
  ]);

  if (result.code !== 0) {
    throw new Error(`Expected wrapper exit code 0, got ${result.code}\n${result.stderr}\n${result.stdout}`);
  }

  if (!result.stdout.includes("[stdout] NODE_FAKE_STDOUT")) {
    throw new Error("Expected live stdout line to be visible.");
  }
  if (
    !result.stdout.includes("--permission-mode")
    || !result.stdout.includes("acceptEdits")
    || !result.stdout.includes("--allowed-tools")
    || !result.stdout.includes("Read,Edit")
    || !result.stdout.includes("--disallowed-tools")
    || !result.stdout.includes("Bash(rm *)")
  ) {
    throw new Error("Expected permission control flags to be passed to Claude.");
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
  if (parsed.permissionMode !== "acceptEdits" || parsed.allowedTools?.[0] !== "Read,Edit" || parsed.disallowedTools?.[0] !== "Bash(rm *)" || parsed.addDirs?.[0] !== workspace) {
    throw new Error(`Permission control metadata was not captured: ${jsonLine}`);
  }

  const artifact = await readFile(parsed.artifactPath, "utf8");
  const log = await readFile(parsed.logPath, "utf8");
  if (!artifact.includes("NODE_FAKE_STDOUT") || !artifact.includes("NODE_FAKE_STDERR")) {
    throw new Error("Expected artifact to include stdout and stderr.");
  }
  if (!log.includes("[stdout] NODE_FAKE_STDOUT") || !log.includes("[stderr] NODE_FAKE_STDERR")) {
    throw new Error("Expected log to include tagged stdout and stderr.");
  }

  const pathLookup = await run(
    process.execPath,
    [
      join(repoRoot, "scripts", "invoke-claude-frontend.mjs"),
      "--workspace",
      workspace,
      "--claude-path",
      "claude",
      "--artifact-dir",
      ".omx/test-artifacts",
      "--prompt",
      "Build a responsive pricing table",
    ],
    {
      env: {
        ...process.env,
        PATH: `${bin}${delimiter}${process.env.PATH || ""}`,
      },
    },
  );
  if (pathLookup.code !== 0 || !pathLookup.stdout.includes("NODE_FAKE_STDOUT")) {
    throw new Error(`Expected PATH lookup to find fake Claude.\n${pathLookup.stderr}\n${pathLookup.stdout}`);
  }

  const compact = await run(process.execPath, [
    join(repoRoot, "scripts", "invoke-claude-frontend.mjs"),
    "--workspace",
    workspace,
    "--claude-path",
    fakeClaudeJson,
    "--artifact-dir",
    ".omx/test-artifacts",
    "--prompt",
    "Build a responsive pricing table",
  ]);
  if (compact.stdout.includes('"type":"system","subtype":"init"')) {
    throw new Error("Expected compact live output, not raw JSON stream.");
  }
  if (!compact.stdout.includes("Claude session started; model=claude-sonnet-4-6")) {
    throw new Error("Expected compact live output summary for JSON stream.");
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
