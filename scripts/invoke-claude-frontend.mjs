#!/usr/bin/env node
import { access, mkdir, writeFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { delimiter } from "node:path";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { constants } from "node:fs";

function parseArgs(argv) {
  const result = {
    workspace: process.cwd(),
    claudePath: "claude",
    artifactDir: ".omx/artifacts",
    model: "sonnet",
    fallbackModel: "",
    effort: "medium",
    heartbeatSeconds: 30,
    prompt: "",
    noLiveOutput: false,
    rawLiveOutput: false,
  };

  const aliases = {
    "-Workspace": "workspace",
    "--workspace": "workspace",
    "-ClaudePath": "claudePath",
    "--claude-path": "claudePath",
    "-ArtifactDir": "artifactDir",
    "--artifact-dir": "artifactDir",
    "-Model": "model",
    "--model": "model",
    "-FallbackModel": "fallbackModel",
    "--fallback-model": "fallbackModel",
    "-Effort": "effort",
    "--effort": "effort",
    "-HeartbeatSeconds": "heartbeatSeconds",
    "--heartbeat-seconds": "heartbeatSeconds",
    "-Prompt": "prompt",
    "--prompt": "prompt",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "-NoLiveOutput" || arg === "--no-live-output") {
      result.noLiveOutput = true;
      continue;
    }
    if (arg === "-RawLiveOutput" || arg === "--raw-live-output") {
      result.rawLiveOutput = true;
      continue;
    }

    const key = aliases[arg];
    if (!key) {
      throw new Error(`Unknown argument: ${arg}`);
    }
    if (index + 1 >= argv.length) {
      throw new Error(`Missing value for ${arg}`);
    }
    result[key] = argv[index + 1];
    index += 1;
  }

  if (!result.prompt) {
    throw new Error("Missing required prompt. Use --prompt <text>.");
  }
  result.heartbeatSeconds = Number(result.heartbeatSeconds);
  if (!Number.isFinite(result.heartbeatSeconds) || result.heartbeatSeconds < 0) {
    throw new Error("heartbeatSeconds must be a non-negative number.");
  }
  return result;
}

function slugify(text) {
  const slug = text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return (slug || "frontend-ui").slice(0, 48).replace(/-+$/g, "") || "frontend-ui";
}

function timestampForFile(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "-",
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("");
}

function truncateText(text, maxLength = 2000) {
  const singleLine = String(text ?? "").replace(/\s+/g, " ").trim();
  if (singleLine.length <= maxLength) {
    return singleLine;
  }
  return `${singleLine.slice(0, maxLength).trimEnd()}... [truncated]`;
}

function compactLiveLine(stream, text) {
  if (stream !== "stdout") {
    return truncateText(text);
  }

  let event;
  try {
    event = JSON.parse(text);
  } catch {
    return truncateText(text);
  }

  if (event.type === "system") {
    if (event.subtype === "init") {
      return `Claude session started; model=${event.model}; cwd=${event.cwd}`;
    }
    if (event.status) {
      return `Claude status: ${event.status}`;
    }
    return "";
  }

  if (event.type === "assistant" && Array.isArray(event.message?.content)) {
    const parts = [];
    for (const content of event.message.content) {
      if (content.type === "text" && content.text?.trim()) {
        parts.push(truncateText(content.text, 2000));
      } else if (content.type === "tool_use") {
        const input = content.input ? JSON.stringify(content.input) : "";
        parts.push(truncateText(`tool ${content.name}: ${input}`, 1000));
      }
    }
    return parts.join(" | ");
  }

  if (event.type === "result") {
    if (event.result?.trim()) {
      return truncateText(`Claude result: ${event.result}`, 4000);
    }
    return `Claude finished: ${event.subtype}`;
  }

  return "";
}

function writeRunLine(stream, text, logStream, quiet, raw = false) {
  const line = `[${new Date().toISOString()}][${stream}] ${text}`;
  logStream.write(`${line}\n`);
  if (!quiet) {
    const visibleText = raw ? text : compactLiveLine(stream, text);
    if (visibleText.trim()) {
      process.stdout.write(`[${stream}] ${visibleText}\n`);
    }
  }
}

async function canExecute(filePath) {
  try {
    await access(filePath, constants.X_OK);
    return true;
  } catch {
    try {
      await access(filePath, constants.F_OK);
      return process.platform === "win32";
    } catch {
      return false;
    }
  }
}

async function resolveExecutable(command) {
  if (command.includes("/") || command.includes("\\") || isAbsolute(command)) {
    const resolved = resolve(command);
    return (await canExecute(resolved)) ? resolved : null;
  }

  const pathExt = process.platform === "win32"
    ? (process.env.PATHEXT || ".COM;.EXE;.BAT;.CMD").split(";")
    : [""];
  const pathParts = (process.env.PATH || "").split(delimiter).filter(Boolean);

  for (const pathPart of pathParts) {
    for (const ext of pathExt) {
      const candidate = join(pathPart, process.platform === "win32" && command.toLowerCase().endsWith(ext.toLowerCase()) ? command : `${command}${ext}`);
      if (await canExecute(candidate)) {
        return candidate;
      }
    }
  }
  return null;
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  const workspacePath = resolve(options.workspace);
  const artifactRoot = isAbsolute(options.artifactDir)
    ? options.artifactDir
    : join(workspacePath, options.artifactDir);

  await mkdir(artifactRoot, { recursive: true });

  const stamp = timestampForFile();
  const slug = slugify(options.prompt);
  const artifactPath = join(artifactRoot, `claude-frontend-${slug}-${stamp}.md`);
  const logPath = join(artifactRoot, `claude-frontend-${slug}-${stamp}.log`);
  const installDeclinedMarkerPath = join(workspacePath, ".omx", "state", "claude-install-declined.json");
  const logStream = createWriteStream(logPath, { encoding: "utf8" });

  const stdoutLines = [];
  const stderrLines = [];
  let exitCode = 127;
  const startTime = Date.now();
  let lastOutputAt = Date.now();
  let heartbeatTimer = null;

  const finishLog = () =>
    new Promise((resolveFinish) => {
      logStream.end(resolveFinish);
    });

  try {
    if (!options.noLiveOutput) {
      process.stdout.write(`[codex-ask-claude] starting Claude CLI in ${workspacePath}\n`);
    }

    const resolvedClaudePath = await resolveExecutable(options.claudePath);
    if (!resolvedClaudePath) {
      const message = `Claude CLI was not found. Ask the user whether to install and configure Claude; if they decline, record that decision at ${installDeclinedMarkerPath}.`;
      stderrLines.push(message);
      writeRunLine("error", message, logStream, options.noLiveOutput, options.rawLiveOutput);
      exitCode = 127;
    } else {
      const claudeArgs = ["-p", "--output-format", "stream-json", "--include-partial-messages"];
      if (options.model) {
        claudeArgs.push("--model", options.model);
      }
      if (options.fallbackModel) {
        claudeArgs.push("--fallback-model", options.fallbackModel);
      }
      if (options.effort) {
        claudeArgs.push("--effort", options.effort);
      }
      claudeArgs.push(options.prompt);

      const child = process.platform === "win32"
        ? spawn(resolvedClaudePath, claudeArgs, {
            cwd: workspacePath,
            windowsHide: true,
            shell: true,
            stdio: ["ignore", "pipe", "pipe"],
          })
        : spawn(resolvedClaudePath, claudeArgs, {
            cwd: workspacePath,
            windowsHide: true,
            stdio: ["ignore", "pipe", "pipe"],
          });

      let spawnError = null;
      child.once("error", (error) => {
        spawnError = error;
        const message = `Claude CLI was not found or could not be started: ${error.message}`;
        stderrLines.push(message);
        writeRunLine("error", message, logStream, options.noLiveOutput, options.rawLiveOutput);
      });

      if (options.heartbeatSeconds > 0) {
        heartbeatTimer = setInterval(() => {
          const idleSeconds = (Date.now() - lastOutputAt) / 1000;
          if (idleSeconds >= options.heartbeatSeconds) {
            lastOutputAt = Date.now();
            writeRunLine("status", "Claude is still running; waiting for output...", logStream, options.noLiveOutput, options.rawLiveOutput);
          }
        }, Math.max(250, Math.min(options.heartbeatSeconds * 1000, 1000)));
      }

      const stdoutReader = createInterface({ input: child.stdout });
      const stderrReader = createInterface({ input: child.stderr });

      stdoutReader.on("line", (line) => {
        stdoutLines.push(line);
        lastOutputAt = Date.now();
        writeRunLine("stdout", line, logStream, options.noLiveOutput, options.rawLiveOutput);
      });
      stderrReader.on("line", (line) => {
        stderrLines.push(line);
        lastOutputAt = Date.now();
        writeRunLine("stderr", line, logStream, options.noLiveOutput, options.rawLiveOutput);
      });

      exitCode = await new Promise((resolveExit) => {
        child.once("close", (code) => {
          resolveExit(spawnError ? 127 : code ?? 0);
        });
      });
    }
  } finally {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
    }
  }

  const durationSeconds = Number(((Date.now() - startTime) / 1000).toFixed(2));
  await finishLog();

  const artifact = [
    "# Claude Frontend Run",
    "",
    "## Prompt",
    "",
    "```text",
    options.prompt,
    "```",
    "",
    "## Exit Code",
    "",
    String(exitCode),
    "",
    "## Duration Seconds",
    "",
    String(durationSeconds),
    "",
    "## Model",
    "",
    options.model,
    "",
    "## Fallback Model",
    "",
    options.fallbackModel,
    "",
    "## Effort",
    "",
    options.effort,
    "",
    "## Live Output Log",
    "",
    logPath,
    "",
    "## Stdout",
    "",
    "```text",
    stdoutLines.join("\n"),
    "```",
    "",
    "## Stderr",
    "",
    "```text",
    stderrLines.join("\n"),
    "```",
    "",
  ].join("\n");

  await mkdir(dirname(artifactPath), { recursive: true });
  await writeFile(artifactPath, artifact, "utf8");

  const outputPreview = truncateText(
    [
      ...stdoutLines.map((line) => compactLiveLine("stdout", line)).filter(Boolean),
      ...stderrLines.map((line) => compactLiveLine("stderr", line)).filter(Boolean),
    ].join("\n"),
    4000,
  );
  const result = {
    success: exitCode === 0,
    exitCode,
    durationSeconds,
    model: options.model,
    fallbackModel: options.fallbackModel,
    effort: options.effort,
    rawLiveOutput: options.rawLiveOutput,
    needsClaudeInstall: exitCode === 127,
    installDeclinedMarkerPath,
    artifactPath,
    logPath,
    outputPreview,
  };

  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = exitCode === 0 ? 0 : exitCode;
}

run().catch(async (error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
