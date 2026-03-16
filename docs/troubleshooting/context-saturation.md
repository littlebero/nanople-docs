---
sidebar_position: 3
---

# The Infinite Wait: Context Saturation Without Timeout in Local LLM Agents

*Why your multi-track research agent hangs forever and how to prevent it*

---

## The Symptom

You trigger a 7-track research agent. It starts. Twenty minutes later, nothing has come back. No error. No partial output. No timeout message. The agent is running — GPU utilization is high — but it's producing nothing.

This is not a crash. It's not a network issue. It's not a model error.

It's context saturation before response generation begins, and it produces an infinite wait because the failure mode occurs in a gap where standard timeout mechanisms don't apply.

---

## Why Standard Timeouts Don't Catch This

Most agent platforms implement timeout at the inference layer — if the model doesn't return a response within N seconds, the session is killed. This works correctly when the model is slow to generate a response.

There's a second factor that makes this harder to diagnose: **direct conversation sessions and Cron isolated sessions have fundamentally different context profiles.**

- **Direct session**: cumulative — shares context with your entire conversation history. By the time you trigger a multi-track run, you're already 5,000–10,000 tokens in.
- **Cron isolated session**: fresh start — only bootstrap files and system prompt. Clean budget every run.

This means a single-track test in a direct session can pass while a 7-track Cron run saturates — and you won't understand why until you understand the context arithmetic below.

The infinite wait happens at a specific point in the Cron execution pipeline:

```
Cron session starts
  → Bootstrap files loaded
  → System prompt injected (SOUL.md)
  → Track 1: web_search called → results returned → added to context
  → Track 2: web_search called → results returned → added to context
  → Track 3: web_search called → results returned → added to context
  ...
  → Track 7: web_search called → results returned → added to context
  → [Context window now at or near capacity]
  → Model attempts to generate response
  → Attention mechanism cannot process token sequence of this length efficiently
  → Token generation rate drops to near-zero
  → Platform timeout is waiting for response to start, not for response to finish
  → No timeout fires
  → Infinite wait
```

The timeout triggers when no response is received. But the model IS generating — just at a rate of effectively 0 tokens per second due to the quadratic cost of attention over a near-full context window. The platform sees ongoing activity. The timeout never fires.

---

## The Numbers for qwen2.5:14b on M3 Pro

Context window: 32,768 tokens (official spec; effective limit lower in some quantizations)

Typical token consumption per track:
- System prompt (SOUL.md): ~3,000–4,000 tokens
- Bootstrap files (TRACKS.md etc.): ~5,000–8,000 tokens
- Web search result, uncapped: ~2,000–6,000 tokens per result
- 3–5 search results per track: ~10,000–30,000 tokens per track

With 7 tracks and uncapped results: system prompt (6K) + 7 tracks × 3 results × 4K average = **90,000+ tokens**.

The context window is 32,768. You hit saturation somewhere in Track 3 or 4. The remaining tracks still execute, still add results, and the context grows past the limit. At inference time, the model is trying to attend over a sequence it cannot process in finite time on available hardware.

---

## The Two-Part Fix

### Part 1: Cap search results per track

Add explicit character limits to each web_search result in your agent instructions:

```markdown
## Research Rules

- Each web_search result: summarize to 4,000 characters maximum before adding to context
- Each track total: do not exceed 2,000 characters in your final track summary
- If results are longer, extract the most relevant 4,000 characters only
```

With this cap: system prompt (6K) + 7 tracks × 3 results × 4K cap = 90K raw, but the model is summarizing before adding to context → actual context stays under 25K.

### Part 2: Run multi-track jobs in isolated Cron sessions only

Never test a full multi-track run in a direct conversation session. The conversation session accumulates context across all your messages. A 7-track run in direct conversation adds to an already-loaded context window.

```
Direct conversation session:
  Previous messages + agent history → already 10,000+ tokens
  + 7-track run → saturation almost certain

Cron isolated session:
  Fresh context → bootstrap files only (~6,000 tokens)
  + 7-track run with caps → stays under 25,000 tokens
```

For testing in direct conversation, run one track at a time with heavy result caps:

```
Test: "Run Track 3 only. Limit all results to 200 characters."
```

---

## Diagnostic: Is This What's Happening to You?

Indicators of context saturation infinite wait:

1. Agent starts, shows activity (tool calls firing), but never produces final output
2. GPU utilization stays high throughout — the model is computing, not crashed
3. No timeout error appears — the session just hangs
4. The hang starts after multiple sequential tool calls (typically 5+)
5. Killing and restarting the session allows a single-track test to complete normally

```bash
# Check if the session is active but not producing output:
openclaw logs --agent berry --limit 50 --follow

# If you see tool calls firing but no "Generating response" or output lines,
# context saturation is the likely cause

# Check approximate context usage:
openclaw sandbox explain --agent berry
# Look for context/token usage metrics if available
```

---

## What We Run in Production

Berry's current Cron configuration after implementing these fixes:

```markdown
# In SOUL.md research rules:
- Per search result: maximum 4,000 characters. Extract most relevant content only.
- Per track output: maximum 500 characters summary for Telegram delivery.
- Total research context: stay under 20,000 tokens across all 7 tracks.

# In TRACKS.md:
- Each track: 2–3 searches maximum
- If first search is comprehensive, skip additional searches for that track
```

Combined with Cron isolated sessions: zero context saturation incidents in production since implementing these limits.

---

## Summary

| Condition | Result |
|-----------|--------|
| Multi-track run, uncapped results, direct session | Almost certain saturation |
| Multi-track run, uncapped results, Cron isolated session | Likely saturation (32K window) |
| Multi-track run, 4K result caps, Cron isolated session | Stable |
| Single-track test, direct session | Safe for validation |

The infinite wait is not a platform bug. It's a predictable consequence of running a model at the edge of its context capacity with no per-result budget. Set the budget explicitly. Verify in Cron.

---

*Field notes from BeroAI | OpenClaw + qwen2.5:14b on MacBook Pro M3 Pro*
*Context window: 32,768 tokens | Model: qwen2.5:14b via Ollama*
