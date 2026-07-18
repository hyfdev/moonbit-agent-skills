import { describe, expect, it } from "vite-plus/test";
import {
  exactTwoSidedSignP,
  pairedSummary,
  type PairableResult,
} from "../../evals/lib/paired_stats.ts";

function result(
  id: string,
  repetition: number,
  condition: string,
  passed: boolean,
  model = "k3",
): PairableResult {
  return {
    id,
    repetition,
    condition,
    passed,
    emitted_models: [model],
    duration_ms: condition === "current" ? 10 : 20,
    usage: { num_turns: condition === "current" ? 2 : 4 },
  };
}

describe("paired eval statistics", () => {
  it("reports cell outcomes but treats tasks as the inference unit", () => {
    const summary = pairedSummary(
      [
        result("task-a", 0, "current", true),
        result("task-a", 0, "ablation", false),
        result("task-a", 1, "current", true),
        result("task-a", 1, "ablation", true),
        result("task-b", 0, "current", false),
        result("task-b", 0, "ablation", true),
        result("task-b", 1, "current", false),
        result("task-b", 1, "ablation", true),
        result("task-c", 0, "current", true),
        result("task-c", 0, "ablation", true),
      ],
      "current",
      "ablation",
    );

    expect(summary).toMatchObject({
      complete_pairs: 5,
      eligible_pairs: 5,
      both_passed: 2,
      left_only: 1,
      right_only: 2,
      both_failed: 0,
      task_count: 3,
      tasks_left_better: 1,
      tasks_right_better: 1,
      tasks_tied: 1,
      exact_task_sign_p: 1,
      both_pass_efficiency: {
        pairs: 2,
        median_duration_ms: { current: 10, ablation: 20 },
        median_turns: { current: 2, ablation: 4 },
      },
    });
    expect(summary.mean_task_pass_rate_difference).toBeCloseTo(-1 / 6);
    expect(summary.task_cluster_bootstrap_95_ci).not.toBeNull();
  });

  it("excludes pairs whose actual models differ or are unobserved", () => {
    const unobserved = result("task-b", 0, "current", true);
    unobserved.emitted_models = [];
    const summary = pairedSummary(
      [
        result("task-a", 0, "current", true, "k3"),
        result("task-a", 0, "ablation", false, "other"),
        unobserved,
        result("task-b", 0, "ablation", true, "k3"),
      ],
      "current",
      "ablation",
    );
    expect(summary.complete_pairs).toBe(2);
    expect(summary.model_mismatch_pairs).toBe(2);
    expect(summary.eligible_pairs).toBe(0);
  });

  it("computes the exact two-sided sign test", () => {
    expect(exactTwoSidedSignP(5, 0)).toBeCloseTo(0.0625);
    expect(exactTwoSidedSignP(3, 2)).toBe(1);
    expect(exactTwoSidedSignP(0, 0)).toBeNull();
  });
});
