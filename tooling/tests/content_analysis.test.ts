import { describe, expect, it } from "vite-plus/test";
import { resultAnalysisEligibility } from "../../evals/run_content.ts";

describe("content result analysis eligibility", () => {
  it("uses the structured per-cell value when present", () => {
    expect(
      resultAnalysisEligibility({
        analysis_eligibility: { eligible: false, reason: "client_failure" },
        exit_code: 0,
      }),
    ).toEqual({ eligible: false, reason: "client_failure" });
  });

  it("classifies legacy successful and turn-limit artifacts without dropping task failures", () => {
    expect(
      resultAnalysisEligibility({
        exit_code: 0,
        timed_out: false,
        checks: [{ check: { type: "client_exit" }, ok: true }],
      }),
    ).toEqual({ eligible: true, reason: "completed" });
    expect(
      resultAnalysisEligibility({
        exit_code: 1,
        timed_out: false,
        checks: [
          {
            check: { type: "client_exit" },
            ok: false,
            detail:
              "claude-code exit 1; timed_out=False; result_subtype=error_max_turns; observed_steps=12; step_limit=12",
          },
        ],
      }),
    ).toEqual({ eligible: true, reason: "predeclared_turn_limit" });
  });

  it("classifies legacy infrastructure failures as ineligible", () => {
    expect(resultAnalysisEligibility({ exit_code: null, timed_out: true })).toEqual({
      eligible: false,
      reason: "wall_timeout",
    });
    expect(resultAnalysisEligibility({ exit_code: null, timed_out: false })).toEqual({
      eligible: false,
      reason: "transport_failure",
    });
    expect(resultAnalysisEligibility({ exit_code: 1, timed_out: false })).toEqual({
      eligible: false,
      reason: "client_failure",
    });
  });
});
