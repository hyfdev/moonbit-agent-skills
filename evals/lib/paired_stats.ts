import type { AnalysisEligibility } from "./agent_cli.ts";

export interface PairableResult {
  id: string;
  condition: string;
  repetition: number;
  passed: boolean;
  analysis_eligibility: AnalysisEligibility;
  emitted_models: string[];
  model_aliases: string[];
  providers: string[];
  thinking_efforts: string[];
  duration_ms?: number | null;
  usage?: Record<string, unknown>;
}

export interface PairedSummary {
  left: string;
  right: string;
  complete_pairs: number;
  eligible_pairs: number;
  missing_pairs: number;
  invalid_pairs: number;
  invalid_pair_reasons: Record<string, number>;
  signature_mismatch_pairs: number;
  signature_mismatch_fields: Record<string, number>;
  model_mismatch_pairs: number;
  both_passed: number;
  left_only: number;
  right_only: number;
  both_failed: number;
  task_count: number;
  tasks_left_better: number;
  tasks_right_better: number;
  tasks_tied: number;
  mean_task_pass_rate_difference: number | null;
  task_cluster_bootstrap_95_ci: [number, number] | null;
  exact_task_sign_p: number | null;
  task_outcomes: Array<{
    id: string;
    eligible_pairs: number;
    left_passed: number;
    right_passed: number;
    both_passed: number;
    left_only: number;
    right_only: number;
    both_failed: number;
    pass_rate_difference: number;
  }>;
  both_pass_efficiency: {
    pairs: number;
    median_duration_ms: Record<string, number | null>;
    median_turns: Record<string, number | null>;
    median_cost_usd: Record<string, number | null>;
  };
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function numberField(record: Record<string, unknown> | undefined, key: string): number | null {
  const value = record?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

const SIGNATURE_FIELDS = [
  "emitted_models",
  "model_aliases",
  "providers",
  "thinking_efforts",
] as const;

type SignatureField = (typeof SIGNATURE_FIELDS)[number];

function normalizedSignatureField(result: PairableResult, field: SignatureField): string[] {
  return [...new Set(result[field])].sort();
}

function mismatchedSignatureFields(
  left: PairableResult,
  right: PairableResult,
): SignatureField[] {
  return SIGNATURE_FIELDS.filter((field) => {
    const leftValues = normalizedSignatureField(left, field);
    const rightValues = normalizedSignatureField(right, field);
    if (field === "emitted_models" && (leftValues.length === 0 || rightValues.length === 0)) {
      return true;
    }
    return JSON.stringify(leftValues) !== JSON.stringify(rightValues);
  });
}

function increment(record: Record<string, number>, key: string): void {
  record[key] = (record[key] ?? 0) + 1;
}

function binomialLowerTail(k: number, n: number): number {
  let probability = 2 ** -n;
  let total = probability;
  for (let index = 1; index <= k; index += 1) {
    probability *= (n - index + 1) / index;
    total += probability;
  }
  return total;
}

export function exactTwoSidedSignP(left: number, right: number): number | null {
  const discordant = left + right;
  if (discordant === 0) return null;
  return Math.min(1, 2 * binomialLowerTail(Math.min(left, right), discordant));
}

function quantile(sorted: number[], probability: number): number {
  const index = (sorted.length - 1) * probability;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function taskClusterBootstrap(differences: number[]): [number, number] | null {
  if (differences.length < 2) return null;
  let state = 0x5eed1234;
  const next = (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
  const samples: number[] = [];
  for (let iteration = 0; iteration < 10_000; iteration += 1) {
    let sum = 0;
    for (let index = 0; index < differences.length; index += 1) {
      sum += differences[Math.floor(next() * differences.length)];
    }
    samples.push(sum / differences.length);
  }
  samples.sort((left, right) => left - right);
  return [quantile(samples, 0.025), quantile(samples, 0.975)];
}

export function pairedSummary(
  results: PairableResult[],
  leftCondition: string,
  rightCondition: string,
): PairedSummary {
  const byKey = new Map<string, Map<string, PairableResult>>();
  for (const result of results) {
    if (result.condition !== leftCondition && result.condition !== rightCondition) continue;
    const key = JSON.stringify([result.id, result.repetition]);
    const pair = byKey.get(key) ?? new Map<string, PairableResult>();
    pair.set(result.condition, result);
    byKey.set(key, pair);
  }

  let completePairs = 0;
  let eligiblePairs = 0;
  let missingPairs = 0;
  let invalidPairs = 0;
  const invalidPairReasons: Record<string, number> = {};
  let signatureMismatchPairs = 0;
  const signatureMismatchFields: Record<string, number> = {};
  let modelMismatchPairs = 0;
  let bothPassed = 0;
  let leftOnly = 0;
  let rightOnly = 0;
  let bothFailed = 0;
  const taskCells = new Map<string, Array<[PairableResult, PairableResult]>>();
  const bothPass: Array<[PairableResult, PairableResult]> = [];

  for (const pair of byKey.values()) {
    const left = pair.get(leftCondition);
    const right = pair.get(rightCondition);
    if (left === undefined || right === undefined) {
      missingPairs += 1;
      continue;
    }
    completePairs += 1;
    if (!left.analysis_eligibility.eligible || !right.analysis_eligibility.eligible) {
      invalidPairs += 1;
      const reasons = [
        !left.analysis_eligibility.eligible
          ? leftCondition + ":" + left.analysis_eligibility.reason
          : null,
        !right.analysis_eligibility.eligible
          ? rightCondition + ":" + right.analysis_eligibility.reason
          : null,
      ].filter((reason): reason is string => reason !== null);
      increment(invalidPairReasons, reasons.join("+"));
      continue;
    }
    const mismatchedFields = mismatchedSignatureFields(left, right);
    if (mismatchedFields.length > 0) {
      signatureMismatchPairs += 1;
      for (const field of mismatchedFields) increment(signatureMismatchFields, field);
      if (mismatchedFields.includes("emitted_models")) modelMismatchPairs += 1;
      continue;
    }
    eligiblePairs += 1;
    const cells = taskCells.get(left.id) ?? [];
    cells.push([left, right]);
    taskCells.set(left.id, cells);
    if (left.passed && right.passed) {
      bothPassed += 1;
      bothPass.push([left, right]);
    } else if (left.passed) {
      leftOnly += 1;
    } else if (right.passed) {
      rightOnly += 1;
    } else {
      bothFailed += 1;
    }
  }

  const taskOutcomes = [...taskCells.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([id, pairs]) => {
      const leftPassed = pairs.filter(([left]) => left.passed).length;
      const rightPassed = pairs.filter(([, right]) => right.passed).length;
      return {
        id,
        eligible_pairs: pairs.length,
        left_passed: leftPassed,
        right_passed: rightPassed,
        both_passed: pairs.filter(([left, right]) => left.passed && right.passed).length,
        left_only: pairs.filter(([left, right]) => left.passed && !right.passed).length,
        right_only: pairs.filter(([left, right]) => !left.passed && right.passed).length,
        both_failed: pairs.filter(([left, right]) => !left.passed && !right.passed).length,
        pass_rate_difference: leftPassed / pairs.length - rightPassed / pairs.length,
      };
    });
  const taskDifferences = taskOutcomes.map((task) => task.pass_rate_difference);
  const tasksLeftBetter = taskDifferences.filter((difference) => difference > 0).length;
  const tasksRightBetter = taskDifferences.filter((difference) => difference < 0).length;
  const tasksTied = taskDifferences.filter((difference) => difference === 0).length;
  const meanDifference =
    taskDifferences.length === 0
      ? null
      : taskDifferences.reduce((sum, value) => sum + value, 0) / taskDifferences.length;

  const values = (
    side: 0 | 1,
    getter: (result: PairableResult) => number | null,
  ): number[] =>
    bothPass
      .map((pair) => getter(pair[side]))
      .filter((value): value is number => value !== null);

  return {
    left: leftCondition,
    right: rightCondition,
    complete_pairs: completePairs,
    eligible_pairs: eligiblePairs,
    missing_pairs: missingPairs,
    invalid_pairs: invalidPairs,
    invalid_pair_reasons: invalidPairReasons,
    signature_mismatch_pairs: signatureMismatchPairs,
    signature_mismatch_fields: signatureMismatchFields,
    model_mismatch_pairs: modelMismatchPairs,
    both_passed: bothPassed,
    left_only: leftOnly,
    right_only: rightOnly,
    both_failed: bothFailed,
    task_count: taskDifferences.length,
    tasks_left_better: tasksLeftBetter,
    tasks_right_better: tasksRightBetter,
    tasks_tied: tasksTied,
    mean_task_pass_rate_difference: meanDifference,
    task_cluster_bootstrap_95_ci: taskClusterBootstrap(taskDifferences),
    exact_task_sign_p: exactTwoSidedSignP(tasksLeftBetter, tasksRightBetter),
    task_outcomes: taskOutcomes,
    both_pass_efficiency: {
      pairs: bothPass.length,
      median_duration_ms: {
        [leftCondition]: median(values(0, (result) => result.duration_ms ?? null)),
        [rightCondition]: median(values(1, (result) => result.duration_ms ?? null)),
      },
      median_turns: {
        [leftCondition]: median(values(0, (result) => numberField(result.usage, "num_turns"))),
        [rightCondition]: median(values(1, (result) => numberField(result.usage, "num_turns"))),
      },
      median_cost_usd: {
        [leftCondition]: median(
          values(0, (result) => numberField(result.usage, "total_cost_usd")),
        ),
        [rightCondition]: median(
          values(1, (result) => numberField(result.usage, "total_cost_usd")),
        ),
      },
    },
  };
}
