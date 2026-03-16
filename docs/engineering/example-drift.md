---
sidebar_position: 3
---

# Your Local LLM Is Not Following Your Examples — It's Inspired by Them

*Why few-shot prompting breaks down for constrained query generation in 14B models*

---

## The Assumption That Fails

You give the model examples. You expect it to follow them. This is the foundational premise of few-shot prompting, and it works well for most tasks with capable models.

For constrained query generation with local 14B models in an agent context, it doesn't work the way you think it does.

---

## What We Expected vs. What Happened

Berry is a 7-track research agent running qwen2.5:14b. Track 3 covers capital flow — VC funding, investment rounds, startup fundraising. We specified query examples in SOUL.md:

```markdown
## Track 3: Capital Flow

Search for recent VC funding and investment activity.

Example queries:
- "AI startup Series B funding 2026"
- "site:crunchbase.com AI investment 2026"
- "PitchBook AI venture capital Q1 2026"
```

Expected output: searches targeting Crunchbase, PitchBook, English-language VC databases.

Actual output: searches for `"AI 스타트업 투자 2026"`, results from 와디즈, 더인벤션랩, Korean tech news sites.

The model read our examples, understood the topic area, and generated its own query variants based on what seemed contextually appropriate — which, because it was running in a Korean-language environment with Korean operator context, meant Korean sources.

The examples were treated as **tone and topic guidance**, not as **constraints**.

---

## Why This Happens

Few-shot examples work by shifting the probability distribution of the model's output toward the demonstrated pattern. For a large, well-aligned model with strong instruction following, this shift is strong enough to consistently produce the demonstrated format.

For qwen2.5:14b in a 14B parameter quantized form, two things reduce the effectiveness of this shift:

**1. Instruction following fidelity degrades at smaller scale**

The model has enough capacity to understand what the examples are showing, but not enough to consistently prioritize "match this format exactly" over "generate the most contextually appropriate response." At 14B parameters, the model is making statistical tradeoffs constantly. Example adherence loses to contextual coherence when they conflict.

**2. The agent context adds noise**

In an interactive session or Cron run, the model has a full system prompt, bootstrap files, previous tool results, and task instructions in context simultaneously. The examples are one signal among many. A larger model can weight them appropriately. A 14B model may deprioritize them when stronger contextual signals point elsewhere.

---

## The Three Failure Modes

### Mode 1 — Language Drift
Model generates queries in the operator's preferred language rather than the specified language. Common when the system prompt or agent name has strong language signals.

### Mode 2 — Source Substitution
Model ignores specified sources (Crunchbase, PitchBook) and substitutes sources it associates with the topic domain from training. If it was trained on more Korean startup coverage than English VC databases, Korean sources feel more natural.

### Mode 3 — Query Reformulation
Model understands the topic but generates semantically equivalent queries with different syntax. "site:crunchbase.com AI investment 2026" becomes "AI investment crunchbase 2026" — still functional, but potentially different results.

---

## What Actually Works

After testing multiple approaches across Berry's Cron runs, the hierarchy of constraint effectiveness from strongest to weakest:

**Strongest: Explicit prohibition + positive constraint combined**
```markdown
Search language: English only. Do not generate queries in Korean or any other language.
Required sources: You MUST include at least one search targeting crunchbase.com or pitchbook.com.
Prohibited: Do not use Korean news sites, Korean investment platforms, or non-English sources.
```

**Medium: Rule statement without prohibition**
```markdown
All web_search queries must be in English.
At least one query per track must target crunchbase.com or pitchbook.com.
```

**Weak (what we started with): Examples only**
```markdown
Example queries:
- "site:crunchbase.com AI investment 2026"
```

The key insight: **examples show what to do; explicit rules prohibit what not to do**. With small models, you need both. The prohibition carries more weight than the positive example.

---

## The Practical Limit

There is a ceiling on how constrained you can make a 14B model's output through prompt engineering alone, and it sits lower than most operators assume.

For source constraints specifically, we've observed:
- Language constraint (English only): ~90% compliance with explicit prohibition
- Platform constraint (Crunchbase/PitchBook): ~70% compliance with explicit rule
- Exact query format constraint (specific syntax): ~50% compliance

Beyond these levels, you're approaching the model's instruction-following ceiling. Options at that point:

1. **Use a larger model** — qwen3:14b scores 0.971 on tool-calling benchmarks vs qwen2.5:14b's 0.812; the improvement extends to instruction following
2. **Post-process and filter** — have a lightweight validation step check that results came from approved sources before including them in output
3. **Accept the variance** — evaluate whether the model's source substitutions actually produce worse results, or just different ones

We chose option 3 for Berry after inspecting two weeks of Cron results. The Korean sources the model selected — 와디즈 for crowdfunding trends, 더인벤션랩 for deep tech funding — contained data that Crunchbase simply didn't have for the Korean market. The model's "drift" was actually domain-appropriate source selection that our English-only constraint would have eliminated.

This changed how we think about constraint enforcement. The goal is not compliance with our prompt. The goal is output quality. When a 14B model's judgment about source selection improves output quality, enforcing stricter constraints is counterproductive.

The practical rule: **enforce constraints that prevent failure (wrong parameter names, wrong tool calls, language confusion in mixed environments). Relax constraints where model judgment adds value (source selection, query formulation).** Run Cron for two weeks before deciding which category a given constraint falls into.

---

## Diagnostic: Is Your Model Following Examples?

```bash
# After a Cron run, inspect the actual queries used:
openclaw cron runs --id <jobId> | grep "web_search"

# Or check the session logs for tool call content:
openclaw sandbox explain --agent berry
```

Look at the `query` parameter in each `web_search` call. If the queries don't match your examples even loosely, you're seeing example drift.

---

## Summary

| Prompt element | What the model treats it as | Compliance rate (14B) |
|---------------|----------------------------|----------------------|
| Few-shot examples | Topic and tone guidance | ~50% format adherence |
| Positive rule ("must use X") | Soft constraint | ~70% adherence |
| Prohibition ("do not use Y") | Hard constraint | ~90% adherence |
| Both rule + prohibition | Strong constraint | Best achievable |

With local 14B models: **specify what to do, prohibit what not to do, verify in logs**. Examples alone are aspirational, not binding.

---

*Field notes from BeroAI | OpenClaw + qwen2.5:14b production operation*
*Applicable to any local LLM in the 7B–14B parameter range used for constrained query generation*
