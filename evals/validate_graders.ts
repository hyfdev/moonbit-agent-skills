#!/usr/bin/env node

import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import {
  grade,
  materializeStarterWorkspace,
  snapshotFiles,
  type BashResult,
  type JsonRecord,
} from "./run_content.ts";

interface ContractCase {
  name: string;
  expected: "pass" | "fail";
  files?: Record<string, string>;
  final_text?: string;
  bash_results?: BashResult[];
  must_fail_check_types?: string[];
}

interface GraderContract {
  area: "language" | "toolchain" | "integration";
  task: string;
  cases: ContractCase[];
}

interface TaskDefinition {
  id: string;
  grade: JsonRecord[];
}

const HERE = dirname(fileURLToPath(import.meta.url));
const CONTRACTS_ROOT = join(HERE, "grader-contracts");

function safeDestination(root: string, path: string): string {
  const destination = resolve(root, path);
  const fromRoot = relative(root, destination);
  if (fromRoot === "" || fromRoot.startsWith("..") || isAbsolute(fromRoot)) {
    throw new Error(`contract file escapes workspace: ${path}`);
  }
  return destination;
}

function loadContracts(ids?: Set<string>): GraderContract[] {
  return readdirSync(CONTRACTS_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(CONTRACTS_ROOT, entry.name, "contract.json"))
    .filter((path) => existsSync(path))
    .map((path) => JSON.parse(readFileSync(path, "utf8")) as GraderContract)
    .filter((contract) => ids === undefined || ids.has(contract.task))
    .sort((left, right) => left.task.localeCompare(right.task));
}

function validateContractShape(contract: GraderContract): void {
  if (!/^[a-zA-Z0-9._-]+$/.test(contract.task)) {
    throw new Error(`invalid contract task id: ${contract.task}`);
  }
  if (contract.cases.length < 3) {
    throw new Error(`${contract.task}: grader contract needs one correct and at least two wrong cases`);
  }
  if (contract.cases.filter((item) => item.expected === "pass").length !== 1) {
    throw new Error(`${contract.task}: grader contract needs exactly one passing case`);
  }
  if (new Set(contract.cases.map((item) => item.name)).size !== contract.cases.length) {
    throw new Error(`${contract.task}: duplicate contract case name`);
  }
}

function runCase(contract: GraderContract, item: ContractCase): JsonRecord {
  const taskDirectory = join(HERE, contract.area, "tasks", contract.task);
  const task = JSON.parse(
    readFileSync(join(taskDirectory, "task.json"), "utf8"),
  ) as TaskDefinition;
  if (task.id !== contract.task) throw new Error(`${contract.task}: task id mismatch`);
  const temporary = mkdtempSync(join(tmpdir(), "mbt-grader-contract-"));
  const project = join(temporary, "project");
  try {
    const starter = join(taskDirectory, "workspace");
    if (existsSync(starter)) {
      materializeStarterWorkspace(starter, project);
    } else {
      mkdirSync(project);
    }
    for (const [path, content] of Object.entries(item.files ?? {})) {
      const destination = safeDestination(project, path);
      mkdirSync(dirname(destination), { recursive: true });
      writeFileSync(destination, content);
    }
    const initialFiles = snapshotFiles(project);
    const checks = task.grade.map((check) => {
      const outcome = grade(
        check,
        project,
        item.final_text ?? "",
        item.bash_results ?? [],
        initialFiles,
      );
      return { type: String(check.type), ok: outcome.ok, detail: outcome.detail };
    });
    const passed = checks.every((check) => check.ok);
    const failedTypes = checks.filter((check) => !check.ok).map((check) => check.type);
    const expectedOutcome = item.expected === "pass" ? passed : !passed;
    const intendedFailures = (item.must_fail_check_types ?? []).every((type) =>
      failedTypes.includes(type),
    );
    return {
      task: contract.task,
      case: item.name,
      expected: item.expected,
      grader_passed: passed,
      contract_passed: expectedOutcome && intendedFailures,
      failed_check_types: failedTypes,
      checks,
    };
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

export function main(argv = process.argv.slice(2)): number {
  const { values } = parseArgs({
    args: argv,
    strict: true,
    allowPositionals: false,
    options: {
      "dry-run": { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
      ids: { type: "string" },
    },
  });
  if (values.help) {
    console.log("Usage: node evals/validate_graders.ts [--ids ID,ID] [--dry-run]");
    return 0;
  }
  const ids = values.ids === undefined ? undefined : new Set(values.ids.split(","));
  const contracts = loadContracts(ids);
  if (contracts.length === 0) throw new Error("no grader contracts selected");
  for (const contract of contracts) validateContractShape(contract);
  if (values["dry-run"]) {
    console.log(`${contracts.length} grader contract(s) valid`);
    return 0;
  }
  const results = contracts.flatMap((contract) =>
    contract.cases.map((item) => runCase(contract, item)),
  );
  const failed = results.filter((result) => result.contract_passed !== true);
  console.log(
    JSON.stringify(
      {
        contracts: contracts.length,
        cases: results.length,
        passed: results.length - failed.length,
        failed: failed.length,
        results,
      },
      null,
      2,
    ),
  );
  return failed.length === 0 ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 1;
  }
}
