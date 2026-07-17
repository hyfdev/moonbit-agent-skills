import { spawnSync } from "node:child_process";

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface RunCommandOptions {
  cwd?: string;
  timeout?: number;
}

export type CommandRunner = (
  command: string,
  args: readonly string[],
  options?: RunCommandOptions,
) => CommandResult;

export const runCommand: CommandRunner = (command, args, options = {}) => {
  const result = spawnSync(command, [...args], {
    cwd: options.cwd,
    encoding: "utf8",
    timeout: options.timeout,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error !== undefined) {
    throw result.error;
  }
  if (result.status === null) {
    throw new Error(`${command} terminated by signal ${result.signal ?? "unknown"}`);
  }
  return {
    exitCode: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
};

export function checkedOutput(
  runner: CommandRunner,
  command: string,
  args: readonly string[],
  options?: RunCommandOptions,
): string {
  const result = runner(command, args, options);
  if (result.exitCode !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} exited ${result.exitCode}:\n${result.stdout}${result.stderr}`,
    );
  }
  return result.stdout.trim();
}
