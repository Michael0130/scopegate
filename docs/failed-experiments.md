# Failed Experiments & Scope Reduction Log

> W2-D5 deliverable (Master Spec §8, D5): 3 failed experiments and one deliberately narrowed
> over-claim. All entries below are real experiments from the D1–D4 build log (2026-10-21/22).

## Experiment 1 — AG Grid v32 UMD bundle with `theme: 'legacy'`

- **Hypothesis**: the latest ag-grid-community v32.3.3 UMD bundle with the legacy CSS theme path
  (`theme: 'legacy'` + `ag-theme-quartz-dark` wrapper class) is the fastest way to a dark grid.
- **What we tried**: vendored v32.3.3, initialized via `agGrid.createGrid(el, { theme: 'legacy', … })`,
  then re-imported the module in-page to capture the stack.
- **Result / why it failed**: every init threw `r?.startUse is not a function` (internal Theming-API
  lifecycle call). The new-API default (`themeQuartz`) initialized fine but ignored dark params in
  this version, so neither path gave a reliable dark legacy grid.
- **Decision**: downgraded the vendored bundle to v31.3.2, where the classic wrapper-class theming
  (`ag-theme-quartz-dark`) works with zero options. One day lost to a library regression; stability
  over novelty.

## Experiment 2 — `glm-4.6` model alias for the gatekeeper LLM

- **Hypothesis**: request `glm-4.6` on the BigModel Coding Plan endpoint — the documented model name
  with the largest context.
- **What we tried**: 6 endpoint/model combinations, then `thinking: {"type":"disabled"}` and JWT
  auth variants to bring latency under the 4-second fail-safe budget.
- **Result / why it failed**: the plan silently routes `glm-4.6` to an always-thinking variant
  (error 1210: "该模型始终思考，不支持关闭思考"). Gatekeeper verdicts took 12–17s with 8–16 token
  budgets burned entirely in `reasoning_content`. Under the spec's 4s timeout every live call fell
  back to the deterministic cache.
- **Decision**: request `glm-5.3-flash` explicitly (thinking can be disabled on it) and slim the LLM
  output contract to a verdict skeleton (~100 tokens). Measured 3.0–3.8s — inside budget.

## Experiment 3 — first API key from the open-platform console

- **Hypothesis**: any API key from the BigModel console can use the Coding Plan quota via the
  `/api/coding/paas/v4` endpoint.
- **What we tried**: 11 models × both endpoints × raw-key and JWT auth — a full exhaustion matrix.
- **Result / why it failed**: every combination returned `1113 余额不足或无可用资源包` while the same
  key could list models (auth valid, quota absent). The key was a regular open-platform key, not
  bound to the plan.
- **Decision**: generated the plan-specific key; both endpoints immediately served traffic. Lesson:
  on this platform, key ≠ plan binding — validate a key with one paid call before building on it.

## Claim deliberately narrowed

- **Over-claim**: "live LLM adjudication in under 4 seconds, always."
- **Narrowed to**: "live LLM adjudication in ~3 seconds typical, with a deterministic verdict cache
  guaranteeing a correct sub-4s answer under provider rate-limiting or outage" (observed during
  testing: burst traffic trips the plan's rate limiter and the fallback path answers instead).
- **Why**: the honest version is stronger — the guarantee comes from the architecture, not the
  provider's mood.
