#!/usr/bin/env node
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { delimiter } from "node:path";
import { dirname, extname, isAbsolute, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { constants } from "node:fs";
import { homedir } from "node:os";

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
    permissionMode: "",
    allowedTools: [],
    disallowedTools: [],
    tools: "",
    addDirs: [],
    sessionKey: "default",
    noSessionReuse: false,
    newSession: false,
    resumeSession: "",
    forkSession: false,
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
    "--permission-mode": "permissionMode",
    "--allowed-tools": "allowedTools",
    "--disallowed-tools": "disallowedTools",
    "--tools": "tools",
    "--add-dir": "addDirs",
    "--session-key": "sessionKey",
    "--resume-session": "resumeSession",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "-NoLiveOutput" || arg === "--no-live-output") {
      result.noLiveOutput = true;
      continue;
    }
    if (arg === "--raw-live-output") {
      result.rawLiveOutput = true;
      continue;
    }
    if (arg === "--no-session-reuse") {
      result.noSessionReuse = true;
      continue;
    }
    if (arg === "--new-session") {
      result.newSession = true;
      continue;
    }
    if (arg === "--fork-session") {
      result.forkSession = true;
      continue;
    }

    const key = aliases[arg];
    if (!key) {
      throw new Error(`Unknown argument: ${arg}`);
    }
    if (index + 1 >= argv.length) {
      throw new Error(`Missing value for ${arg}`);
    }
    if (Array.isArray(result[key])) {
      result[key].push(argv[index + 1]);
    } else {
      result[key] = argv[index + 1];
    }
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

function slugifyKey(text) {
  const slug = String(text ?? "").toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return (slug || "default").slice(0, 80).replace(/-+$/g, "") || "default";
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

function expandHomePath(value) {
  if (typeof value !== "string" || value === "~" || !value.startsWith("~/")) {
    return value === "~" ? homedir() : value;
  }
  return join(homedir(), value.slice(2));
}

function defaultExecutableSearchPaths() {
  if (process.platform === "win32") {
    return [];
  }

  return [
    "~/.local/bin",
    "~/.npm-global/bin",
    "~/bin",
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
  ];
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
    if (event.status !== undefined && event.status !== null && String(event.status).trim()) {
      return `Claude status: ${truncateText(event.status)}`;
    }
    if (event.subtype && event.subtype !== "ready") {
      return `Claude system: ${truncateText(event.subtype)}`;
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

function isWindowsCommandShim(filePath) {
  return process.platform === "win32" && /\.(?:cmd|bat)$/i.test(filePath);
}

function quoteForCmd(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function assertSafeWindowsCommandShimArgs(args) {
  const unsafePattern = /[\r\n%&|<>^!]/;
  const unsafeArg = args.find((arg) => unsafePattern.test(String(arg)));
  if (unsafeArg !== undefined) {
    throw new Error(
      "Refusing to pass shell-sensitive characters through a Windows .cmd/.bat Claude shim. "
      + "Install or point --claude-path at claude.exe for prompts containing %, !, &, |, <, >, ^, or newlines.",
    );
  }
}

function buildClaudeSpawn(resolvedClaudePath, claudeArgs) {
  if (!isWindowsCommandShim(resolvedClaudePath)) {
    return {
      command: resolvedClaudePath,
      args: claudeArgs,
      windowsVerbatimArguments: false,
    };
  }

  assertSafeWindowsCommandShimArgs(claudeArgs);
  return {
    command: process.env.ComSpec || "cmd.exe",
    args: [
      "/d",
      "/s",
      "/c",
      `"${[resolvedClaudePath, ...claudeArgs].map(quoteForCmd).join(" ")}"`,
    ],
    windowsVerbatimArguments: true,
  };
}

function extractClaudeSessionId(lines) {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (!line.startsWith("{")) {
      continue;
    }
    try {
      const event = JSON.parse(line);
      if (typeof event.session_id === "string" && event.session_id) {
        return event.session_id;
      }
      if (typeof event.sessionId === "string" && event.sessionId) {
        return event.sessionId;
      }
    } catch {
      // Ignore non-JSON lines and keep scanning.
    }
  }
  return "";
}

async function readSessionState(statePath) {
  try {
    return JSON.parse(await readFile(statePath, "utf8"));
  } catch {
    return null;
  }
}

async function writeSessionState(statePath, state) {
  await mkdir(dirname(statePath), { recursive: true });
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
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
  const expandedCommand = expandHomePath(command);

  if (command.includes("/") || command.includes("\\") || isAbsolute(command)) {
    const resolved = resolve(expandedCommand);
    return (await canExecute(resolved)) ? resolved : null;
  }

  const pathExt = process.platform === "win32"
    ? (process.env.PATHEXT || ".COM;.EXE;.BAT;.CMD").split(";")
    : [""];
  const pathParts = [
    ...(process.env.PATH || "").split(delimiter).filter(Boolean),
    ...defaultExecutableSearchPaths(),
  ];
  const uniquePathParts = [...new Set(pathParts.map(expandHomePath))];
  const hasExplicitWindowsExtension = process.platform === "win32" && extname(expandedCommand) !== "";
  const extensionsToTry = hasExplicitWindowsExtension ? [""] : pathExt;

  for (const pathPart of uniquePathParts) {
    for (const ext of extensionsToTry) {
      const candidate = join(pathPart, process.platform === "win32" && expandedCommand.toLowerCase().endsWith(ext.toLowerCase()) ? expandedCommand : `${expandedCommand}${ext}`);
      if (await canExecute(candidate)) {
        return candidate;
      }
    }
  }
  return null;
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  const workspacePath = resolve(expandHomePath(options.workspace));
  const artifactDirPath = expandHomePath(options.artifactDir);
  const artifactRoot = isAbsolute(artifactDirPath)
    ? artifactDirPath
    : join(workspacePath, artifactDirPath);

  await mkdir(artifactRoot, { recursive: true });

  const stamp = timestampForFile();
  const slug = slugify(options.prompt);
  const artifactPath = join(artifactRoot, `claude-frontend-${slug}-${stamp}.md`);
  const logPath = join(artifactRoot, `claude-frontend-${slug}-${stamp}.log`);
  const installDeclinedMarkerPath = join(workspacePath, ".omx", "state", "claude-install-declined.json");
  const sessionKey = slugifyKey(options.sessionKey);
  const sessionStatePath = join(workspacePath, ".omx", "state", "claude-sessions", `${sessionKey}.json`);
  const sessionReuseEnabled = !options.noSessionReuse;
  const storedSession = sessionReuseEnabled && !options.newSession
    ? await readSessionState(sessionStatePath)
    : null;
  const sessionToResume = options.resumeSession || storedSession?.sessionId || "";
  const resumedSession = Boolean(sessionReuseEnabled && sessionToResume && !options.newSession);
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
      const claudeArgs = ["-p", options.prompt, "--output-format", "stream-json", "--include-partial-messages"];
      if (options.model) {
        claudeArgs.push("--model", options.model);
      }
      if (options.fallbackModel) {
        claudeArgs.push("--fallback-model", options.fallbackModel);
      }
      if (options.effort) {
        claudeArgs.push("--effort", options.effort);
      }
      if (options.permissionMode) {
        claudeArgs.push("--permission-mode", options.permissionMode);
      }
      if (options.tools) {
        claudeArgs.push("--tools", options.tools);
      }
      for (const allowedTool of options.allowedTools) {
        claudeArgs.push("--allowed-tools", allowedTool);
      }
      for (const disallowedTool of options.disallowedTools) {
        claudeArgs.push("--disallowed-tools", disallowedTool);
      }
      for (const addDir of options.addDirs) {
        claudeArgs.push("--add-dir", expandHomePath(addDir));
      }
      if (resumedSession) {
        claudeArgs.push("--resume", sessionToResume);
        if (options.forkSession) {
          claudeArgs.push("--fork-session");
        }
      }
      const spawnSpec = buildClaudeSpawn(resolvedClaudePath, claudeArgs);
      const child = spawn(spawnSpec.command, spawnSpec.args, {
        cwd: workspacePath,
        windowsHide: true,
        windowsVerbatimArguments: spawnSpec.windowsVerbatimArguments,
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

  const sessionId = extractClaudeSessionId(stdoutLines);
  if (sessionReuseEnabled && sessionId) {
    await writeSessionState(sessionStatePath, {
      sessionKey,
      sessionId,
      previousSessionId: resumedSession ? sessionToResume : storedSession?.sessionId || "",
      resumedSession,
      forkedSession: Boolean(options.forkSession && resumedSession),
      updatedAt: new Date().toISOString(),
      workspacePath,
      model: options.model,
      effort: options.effort,
      artifactPath,
      logPath,
    });
  }

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
    permissionMode: options.permissionMode,
    allowedTools: options.allowedTools,
    disallowedTools: options.disallowedTools,
    tools: options.tools,
    addDirs: options.addDirs,
    sessionReuseEnabled,
    sessionKey,
    sessionId,
    resumedSession,
    sessionStatePath,
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
