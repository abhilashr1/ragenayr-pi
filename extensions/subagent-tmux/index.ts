import { execFileSync, spawn } from "node:child_process";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type, type Static } from "typebox";

const subagentSchema = Type.Object({
  agentName: Type.String({ description: "Human-readable agent name" }),
  taskId: Type.String({ description: "Task identifier" }),
  command: Type.String({ description: "Shell command to run in pane" }),
});

const schema = Type.Object({
  subagents: Type.Array(subagentSchema, { minItems: 1, description: "Subagents to launch" }),
  workingDirectory: Type.Optional(Type.String({ description: "Working directory for launched commands" })),
  launchMode: Type.Optional(
    Type.Union([Type.Literal("split"), Type.Literal("popup"), Type.Literal("window")], {
      description: "Launch mode: split panes in current window, floating popups, or a dedicated tmux window",
      default: "window",
    }),
  ),
  splitStrategy: Type.Optional(
    Type.Union([Type.Literal("alternate"), Type.Literal("vertical"), Type.Literal("horizontal")], {
      description: "How to split inside the right cluster (split mode only)",
      default: "alternate",
    }),
  ),
  closeOnExit: Type.Optional(Type.Boolean({ description: "Auto-close pane when subagent command exits", default: true })),
});

type Input = Static<typeof schema>;

type PaneLaunch = {
  paneId: string;
  paneTty: string;
  paneTitle: string;
  agentName: string;
  taskId: string;
  command: string;
};

function tmux(args: string[]): string {
  try {
    return execFileSync("tmux", args, { encoding: "utf8" }).trim();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`tmux ${args.join(" ")} failed: ${message}`);
  }
}

function shortTaskId(taskId: string): string {
  return taskId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 8) || "task";
}

function launchSubagents(input: Input): {
  ok: boolean;
  error?: string;
  leftPrimaryPane?: string;
  launched: PaneLaunch[];
} {
  if (!process.env.TMUX) {
    return { ok: false, error: "Not inside tmux (TMUX is unset).", launched: [] };
  }

  let activePaneTarget = "";
  try {
    activePaneTarget = tmux(["display-message", "-p", "#{pane_id}"]);
    tmux(["display-message", "-p", "#S:#I:#P"]);
  } catch (error) {
    return { ok: false, error: `Failed to detect active tmux context: ${String(error)}`, launched: [] };
  }

  const launched: PaneLaunch[] = [];

  try {
    if (input.launchMode === "popup") {
      for (let i = 0; i < input.subagents.length; i++) {
        const sub = input.subagents[i];
        const title = `${sub.agentName}#${shortTaskId(sub.taskId)}`;
        const cdPrefix = input.workingDirectory ? `cd ${JSON.stringify(input.workingDirectory)} && ` : "";
        const command = input.closeOnExit === false ? `${cdPrefix}${sub.command}` : `${cdPrefix}${sub.command}; exit`;
        tmux(["display-popup", "-w", "50%", "-h", "80%", "-T", title, "-E", command]);
        launched.push({
          paneId: `popup:${title}`,
          paneTty: "popup",
          paneTitle: title,
          agentName: sub.agentName,
          taskId: sub.taskId,
          command: sub.command,
        });
      }
      return { ok: true, leftPrimaryPane: activePaneTarget, launched };
    }

    if (input.launchMode === "window") {
      const windowName = `subagents-${Date.now().toString().slice(-6)}`;
      const first = input.subagents[0];
      const firstTitle = `${first.agentName}#${shortTaskId(first.taskId)}`;
      const firstCdPrefix = input.workingDirectory ? `cd ${JSON.stringify(input.workingDirectory)} && ` : "";
      const firstCommand = input.closeOnExit === false ? `${firstCdPrefix}${first.command}` : `${firstCdPrefix}${first.command}; exit`;

      const rootPaneId = tmux(["new-window", "-n", windowName, "-P", "-F", "#{pane_id}", firstCommand]);
      tmux(["select-pane", "-t", rootPaneId, "-T", firstTitle]);
      launched.push({
        paneId: rootPaneId,
        paneTty: tmux(["display-message", "-p", "-t", rootPaneId, "#{pane_tty}"]),
        paneTitle: firstTitle,
        agentName: first.agentName,
        taskId: first.taskId,
        command: first.command,
      });

      let currentPane = rootPaneId;
      for (let i = 1; i < input.subagents.length; i++) {
        const sub = input.subagents[i];
        const title = `${sub.agentName}#${shortTaskId(sub.taskId)}`;
        const cdPrefix = input.workingDirectory ? `cd ${JSON.stringify(input.workingDirectory)} && ` : "";
        const command = input.closeOnExit === false ? `${cdPrefix}${sub.command}` : `${cdPrefix}${sub.command}; exit`;

        const strategy = input.splitStrategy ?? "alternate";
        const splitFlag =
          strategy === "horizontal" ? "-h" : strategy === "vertical" ? "-v" : i % 2 === 1 ? "-v" : "-h";

        currentPane = tmux(["split-window", splitFlag, "-t", currentPane, "-P", "-F", "#{pane_id}", command]);
        tmux(["select-pane", "-t", currentPane, "-T", title]);

        launched.push({
          paneId: currentPane,
          paneTty: tmux(["display-message", "-p", "-t", currentPane, "#{pane_tty}"]),
          paneTitle: title,
          agentName: sub.agentName,
          taskId: sub.taskId,
          command: sub.command,
        });
      }

      if (input.subagents.length > 1) tmux(["select-layout", "-t", rootPaneId, "tiled"]);
      return { ok: true, leftPrimaryPane: activePaneTarget, launched };
    }

    const first = input.subagents[0];
    const firstTitle = `${first.agentName}#${shortTaskId(first.taskId)}`;
    const firstCdPrefix = input.workingDirectory ? `cd ${JSON.stringify(input.workingDirectory)} && ` : "";
    const firstCommand = input.closeOnExit === false
      ? `${firstCdPrefix}${first.command}`
      : `${firstCdPrefix}${first.command}; exit`;

    const rootPaneId = tmux([
      "split-window",
      "-h",
      "-p",
      "50",
      "-t",
      activePaneTarget,
      "-P",
      "-F",
      "#{pane_id}",
      firstCommand,
    ]);

    tmux(["select-pane", "-t", rootPaneId, "-T", firstTitle]);

    launched.push({
      paneId: rootPaneId,
      paneTty: tmux(["display-message", "-p", "-t", rootPaneId, "#{pane_tty}"]),
      paneTitle: firstTitle,
      agentName: first.agentName,
      taskId: first.taskId,
      command: first.command,
    });

    let currentRightPane = rootPaneId;

    for (let i = 1; i < input.subagents.length; i++) {
      const sub = input.subagents[i];
      const title = `${sub.agentName}#${shortTaskId(sub.taskId)}`;
      const cdPrefix = input.workingDirectory ? `cd ${JSON.stringify(input.workingDirectory)} && ` : "";
      const command = input.closeOnExit === false ? `${cdPrefix}${sub.command}` : `${cdPrefix}${sub.command}; exit`;

      const strategy = input.splitStrategy ?? "alternate";
      const splitFlag =
        strategy === "horizontal" ? "-h" : strategy === "vertical" ? "-v" : i % 2 === 1 ? "-v" : "-h";

      currentRightPane = tmux([
        "split-window",
        splitFlag,
        "-t",
        currentRightPane,
        "-P",
        "-F",
        "#{pane_id}",
        command,
      ]);

      tmux(["select-pane", "-t", currentRightPane, "-T", title]);

      launched.push({
        paneId: currentRightPane,
        paneTty: tmux(["display-message", "-p", "-t", currentRightPane, "#{pane_tty}"]),
        paneTitle: title,
        agentName: sub.agentName,
        taskId: sub.taskId,
        command: sub.command,
      });
    }

    if (input.subagents.length > 1) {
      tmux(["select-layout", "-t", rootPaneId, "tiled"]);
      tmux(["resize-pane", "-t", activePaneTarget, "-x", "50%"]);
    }

    return { ok: true, leftPrimaryPane: activePaneTarget, launched };
  } catch (error) {
    return { ok: false, error: `Failed to launch tmux subagents: ${String(error)}`, leftPrimaryPane: activePaneTarget, launched };
  }
}

async function runSubagentsStream(
  input: Input,
  onUpdate?: (update: { content: Array<{ type: "text"; text: string }> }) => void,
): Promise<{ status: "ok"; launched: PaneLaunch[] }> {
  const launched: PaneLaunch[] = input.subagents.map((sub, idx) => ({
    paneId: `local:${idx + 1}`,
    paneTty: "local",
    paneTitle: `${sub.agentName}#${shortTaskId(sub.taskId)}`,
    agentName: sub.agentName,
    taskId: sub.taskId,
    command: sub.command,
  }));

  const procs = input.subagents.map((sub, idx) => {
    const name = `${sub.agentName}#${shortTaskId(sub.taskId)}`;
    const child = spawn("bash", ["-lc", sub.command], {
      cwd: input.workingDirectory,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const emit = (text: string) => {
      const trimmed = text.replace(/\s+$/, "");
      if (!trimmed) return;
      onUpdate?.({ content: [{ type: "text", text: `[${name}] ${trimmed}` }] });
    };

    child.stdout.on("data", (buf) => emit(String(buf)));
    child.stderr.on("data", (buf) => emit(String(buf)));

    return new Promise<void>((resolve) => {
      child.on("close", (code) => {
        onUpdate?.({ content: [{ type: "text", text: `[${name}] exited with code ${code ?? -1}` }] });
        resolve();
      });
    });
  });

  await Promise.all(procs);
  return { status: "ok", launched };
}

export default function subagentTmuxExtension(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "subagent_runner",
    label: "Subagent runner",
    description: "Spawn subagents in a dedicated window (default), split cluster, popup, or local stream mode.",
    promptSnippet: "Launch one or more subagents with visible live output.",
    promptGuidelines: ["Use subagent_runner whenever the user asks to create or run subagents."],
    parameters: schema,
    async execute(_toolCallId, input: Input, _signal, onUpdate) {
      if (!process.env.TMUX) {
        const streamed = await runSubagentsStream(input, onUpdate);
        return {
          content: [{ type: "text", text: `Ran ${streamed.launched.length} subagent(s) in local stream mode (no tmux).` }],
          details: { status: "ok", mode: "local-stream", launched: streamed.launched },
        };
      }

      const result = launchSubagents(input);
      if (!result.ok) {
        return {
          isError: true,
          content: [{ type: "text", text: result.error ?? "Unknown error" }],
          details: { status: "error", leftPrimaryPane: result.leftPrimaryPane, launched: result.launched },
        };
      }

      return {
        content: [
          {
            type: "text",
            text: `Launched ${result.launched.length} subagent pane(s): ${result.launched.map((p) => p.paneId).join(", ")}`,
          },
        ],
        details: { status: "ok", mode: input.launchMode ?? "window", leftPrimaryPane: result.leftPrimaryPane, launched: result.launched },
      };
    },
  });
}
