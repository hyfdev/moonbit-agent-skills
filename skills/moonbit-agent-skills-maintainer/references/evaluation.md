# Evaluating skill changes

Use this workflow when a repository change is expected to alter skill activation, knowledge retrieval, or task outcomes. Read `evals/CLIENTS.md` before selecting a local client.

## Separate the questions

Do not combine these measurements:

1. **Deterministic verification:** does the documented MoonBit claim hold at the pinned toolchain?
2. **Routing:** can an agent select the applicable skill before its first domain action?
3. **Discoverability:** after the skill is available, does the agent find the relevant reference before editing, answering, or running a diagnostic that reveals the answer?
4. **Task outcome:** does the final answer or workspace pass a hidden behavior grader?
5. **Contradiction reporting:** does the agent verify a mismatch, prepare a scrubbed draft, and stop before external submission?

Report each independently. A passing task does not prove activation; a `Skill` call does not prove that its guidance affected the task.

## Select tasks by failure risk

Classify every candidate before spending model calls:

| Class | Primary evidence | Model eval policy |
| --- | --- | --- |
| Compiler/CLI self-corrects the error | fixture, checked doc, or command smoke test | keep out of the primary paid/subscription score unless measuring efficiency |
| Wrong behavior can compile or build | hidden runtime, cross-package, or boundary test | include in the primary content eval |
| Current fact has no diagnostic | exact answer or hidden semantic test | include when training-data staleness is plausible |
| Only the route changed | controlled routing/discoverability ablation | compare byte-identical skills except for that route |

Prefer tasks such as JSON layout, block-scoped `defer`, downstream `pub extend`, internal-package access, runtime FFI calls, and warning-only migrations. Generic syntax repair, package creation, and commands discoverable from `--help` are calibration or smoke tasks when every condition already passes them.

Each primary task records a stable claim ID, risk class, primary metric, task files, and grader files. Do not expose the answer through the prompt, starter comments, compiler diagnostic, filename, or test name unless the experiment explicitly measures application rather than discovery.

When one experiment mixes primary tasks with regression controls or distinct risk classes, declare task groups in the frozen manifest and report each group separately. Never let easy controls dilute or inflate the effect estimate for the primary claim.

## Prove the grader before model calls

For every primary task:

1. Run one canonical correct solution; every required check must pass.
2. Run at least two plausible wrong solutions; each must fail for the intended reason.
3. Cover the shortcuts most likely to create a false pass: deleting tests, empty projects, hard-coded outputs, comments satisfying source regexes, build-only FFI, private declarations standing in for public APIs, qualified calls standing in for dot calls, and package-wide commands standing in for file-scoped commands.
4. Prefer hidden runtime and cross-package tests over source regexes. Use source checks only to enforce an API or migration property that behavior cannot distinguish.
5. Keep the agent workspace and hidden grader files separate; install hidden files only after the agent exits.

A task whose wrong solutions pass is a broken grader, not a model success. Correct the grader and discard affected measurements instead of retroactively claiming them.

## Isolate the changed variable

When evaluating an existing skill, compare the current version with a purpose-built ablation whenever possible. The two conditions must be byte-identical outside the feature under test. For a top-level `extend` route, remove only the top-level description/index/rule and keep `references/traits-and-generics.mbt.md` byte-identical. A historical skill that already contains the deep syntax cannot isolate the new route.

Pin and hash every condition before the first call. Record the task hash, skill tree, ablation transformation, runner/parser/grader hashes, toolchain components, provider, CLI version, requested model, observed model, repetitions, ordering, time/step limits, and budget rule in `run.json`.

## Pair and repeat

Run every task under both conditions with the same client and observed model. Alternate AB/BA order across task and repetition. Never compare an `ours`-only strong-model supplement with a baseline from another model.

Use the task as the unit of inference:

- show complete pairs, both pass, current only, ablation/baseline only, both fail, missing pairs, and observed-model mismatches;
- compute each task's pass-rate difference across repetitions, then average task differences;
- use a task-clustered interval and a task-level exact sign test for exploratory uncertainty;
- compare duration, steps, tokens, and cost only for pairs where both conditions pass;
- keep provider results separate.

Assertions within one scenario are correlated checks, not independent samples. Report a reporting suite with three scenarios as `n=3`, even when it contains twenty-nine assertions.

Two or three repetitions are enough to screen for large effects and regressions, not to establish a small general improvement. Predeclare the smallest difference worth acting on. If the interval crosses zero or no task favors current, say that the result did not establish improvement.

## Activation protocol

Maintain two activation measurements:

- **Routing-only:** present the controlled catalog and stop at the first routing decision. Measure required skill recall, forbidden activation, exact set, and whether the decision precedes any domain action.
- **End-to-end:** run the natural task with normal tools. Measure final hidden behavior separately and record whether skill/reference use occurred before the first edit, write, shell command, or final answer.

Use realistic near-boundary prompts: FFI declaration versus JS link configuration, a source-level `using` declaration versus package imports, a test block versus selecting a test command, and a task that legitimately needs both product skills. Negative prompts about unrelated languages or moon phases are only sanity checks; they do not test the product boundary well.

Keep a held-out prompt set when tuning descriptions. Run old and new descriptions in the same batch, with the same catalog and actual model, for multiple paired repetitions. A one-off historical snapshot is observation, not attribution.

## Budget and stopping rules

Kimi subscription runs use a predeclared maximum cell count, wall timeout, and step limit; report token usage and duration and leave USD unavailable. Claude Code/API runs require an explicit total USD budget before the first call, pass the remaining amount to each child process, and stop before a cell that would exceed the budget.

Use this sequence:

1. Run all deterministic verification and grader contracts for free.
2. Use Kimi/K3 once per condition to remove broken, trivial, or universally passing tasks.
3. Run the retained Kimi paired experiment for two or three repetitions.
4. Before looking at Claude results, freeze a small cross-check subset and its stopping rule.
5. Run Claude/DeepSeek Flash on that subset; use Pro only for predeclared disagreements or unstable cells.

Do not add model evals to CI. Parser, schema, statistics, and grader-contract tests belong in the ordinary TypeScript test suite; stochastic model calls remain explicit local experiments with checked-in result summaries.

## Completion report

State what the experiment can and cannot support. Include tables for task-level outcomes, activation metrics, observed models, repetitions, excluded pairs, token/cost usage, and grader-contract results. Lead with current-only versus baseline/ablation-only tasks. List non-discriminating tasks removed from the primary score and any grader defect that invalidated earlier cells.
