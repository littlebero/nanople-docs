---
sidebar_position: 1
---

# Writing SOUL.md for Local LLMs: What Cloud Model Habits Get Wrong

*System prompt engineering is different at 14B parameters — here's the complete prescription*

---

## The Checklist (If You're in a Hurry)

Before running any agent in Cron, verify these 8 things:

```
□ Every required tool call has an explicit tool name in SOUL.md
□ Every write operation specifies exact parameter names (path, NOT file_path)
□ Every path in SOUL.md is an absolute path (no ~, no $HOME)
□ Every behavioral constraint has a positive rule + a prohibition
□ Total rule count: 5 or fewer
□ Direct session single-track test: confirmed web_search was called (check logs)
□ Direct session single-track test: confirmed write was called with correct params
□ File exists on disk after test run — verify, don't trust the model's output
```

If any of these fail, read the relevant section below. If all pass, your SOUL.md is production-ready.

---

## The Cloud Model Habit

With GPT-4, Claude, or Gemini, you can write a system prompt like this and it works:

```markdown
You are a research agent. When asked to research a topic, search the web and 
compile your findings into a report. Save your work to the reports folder.
```

The model infers: search means call `web_search`, save means call `write`, reports folder means the configured workspace path.

With a local 14B model in an agent context, this prompt produces: a text-only response describing what research the model would do, saved nowhere, with no tool calls.

The gap is not intelligence. The model understands the task. The gap is **instruction-following precision at the tool-call boundary** — and bridging it requires a different approach to system prompt design.

---

## The Four Prescriptions

### Prescription 1: Name the tool, not the action

**Cloud model habit:**
```markdown
Search for recent developments in AI funding.
```

**Local LLM requirement:**
```markdown
Call the `web_search` tool with query: "AI startup funding 2026 venture capital"
```

The word "search" in a language model's context means many things — it might mean invoke a tool, or it might mean "I will now discuss what I know about this topic." At 14B parameters, "search" resolves to whichever meaning is statistically more common in the training data at that point in context.

`web_search` is unambiguous. It's a specific string that maps to a specific function. Use it.

**Rule: Any action that requires a tool call must name the exact tool.**

---

### Prescription 2: Specify exact parameter names and path formats

**Cloud model habit:**
```markdown
Save your research to the reports directory.
```

**Local LLM requirement:**
```markdown
Save your research using the `write` tool with these exact parameters:
- `path`: /Users/sero/.openclaw/workspace-berry/reports/YYYY-MM-DD.md  
  (replace YYYY-MM-DD with today's date, e.g. 2026-03-13)
  Do NOT use `~`, `$HOME`, or relative paths — use the full absolute path only.
- `content`: the complete research output in markdown format
```

Why this verbose? The model doesn't read your tool schema at inference time. It generates parameter names from its training data. `file_path` feels more natural to qwen2.5:14b than `path` based on how file operations were described in its training corpus. If you don't specify `path`, you'll get `file_path`, and the write will fail silently.

**Rule: For any tool that writes, creates, or sends — specify the exact parameter name and a concrete path/format example.**

---

### Prescription 3: Add prohibitions, not just instructions

**Cloud model habit:**
```markdown
Use English-language sources. Search Crunchbase and PitchBook for funding data.
```

**Local LLM requirement:**
```markdown
Search language: English ONLY.
Required: At least one search per track must target crunchbase.com or pitchbook.com.
PROHIBITED: Do not generate queries in Korean or any non-English language.
PROHIBITED: Do not use Korean investment platforms (와디즈, 더인벤션랩, or similar).
```

Positive instructions shift probability. Prohibitions constrain the probability space. With a 14B model operating in a multilingual context (Korean operator, Korean agent name), the ambient probability of generating Korean queries is non-trivial. You need to explicitly exclude the failure path, not just specify the success path.

**Rule: For any behavioral constraint, include both a positive requirement and a prohibition against the most likely failure mode.**

---

### Prescription 4: Keep the rule count minimal

The counterintuitive constraint. More rules do not produce more compliant behavior in small models — they produce lower compliance across all rules.

In our testing: an agent with 10 rules in SOUL.md complied with roughly 6–7 of them consistently. An agent with 5 rules complied with 4–5. The compliance rate per rule is approximately constant; the total rule count determines how many rules get followed.

**Keep SOUL.md rules to 5 or fewer.** If you have more than 5 behavioral requirements, rank them by operational criticality and include only the top 5. The rest are aspirational.

Priority ranking for Berry:
1. Call `web_search` tool explicitly (not negotiable — without this, nothing works)
2. Call `write` tool with correct parameters (not negotiable — output disappears otherwise)
3. Keep output under 4,000 characters per track (performance requirement)
4. Use English queries (quality requirement)
5. Complete all 7 tracks before writing (structural requirement)

Rules 6–10 we wanted: source quality requirements, formatting specifics, fallback behaviors — all cut.

---

## Complete SOUL.md Template for a Research Agent

```markdown
# [Agent Name] — Research Agent

## Identity
You are [Agent Name], a research agent. You gather information and save it as reports.

## Core Rules (follow all 5)

**Rule 1 — Search:** For each research track, call `web_search` at least once.
Do not write from memory. A research result without a `web_search` tool call is invalid.

**Rule 2 — Save:** After completing all tracks, call `write` to save your report.
- Tool: `write`
- Parameter: `path` = /[absolute path to reports directory]/YYYY-MM-DD.md
- Parameter: `content` = your complete report in markdown
- Do NOT use `~` or `$HOME`. Use the full absolute path.
- Do NOT describe saving the file. Call the tool.

**Rule 3 — Size:** Each track result: maximum 4,000 characters.
Each track summary: maximum 500 characters. Stay within these limits.

**Rule 4 — Language:** All search queries must be in English.
Do not generate queries in Korean or other languages.

**Rule 5 — Completion:** Complete all tracks before calling `write`.
Do not call `write` after each track. One write call at the end.

---

## Tracks
[See TRACKS.md]
```

Five rules. Each one specifies a tool name, parameter name, or explicit prohibition. None of them are vague.

---

## What to Put in TRACKS.md vs. SOUL.md

Split the content based on what changes between deployments:

**SOUL.md** — behavioral rules that are always true:
- Which tools to call
- Exact parameter names
- Output size limits
- Language constraints

**TRACKS.md** — content that changes with the research domain:
- Track names and topics
- Sample queries per track
- Source preferences
- Output format per track

Keep SOUL.md short. The behavioral rules should fit in one screen. If SOUL.md is growing past 2,000 characters of actual rules (not comments), cut it.

---

## The Verification Checklist

Before running a new agent in Cron:

```
□ Every required tool call has an explicit tool name in SOUL.md
□ Every write operation specifies exact parameter names
□ Every path in SOUL.md is an absolute path (no ~, no $HOME)
□ Every behavioral constraint has a positive rule + a prohibition
□ Total rule count: 5 or fewer
□ Direct session single-track test: confirmed web_search was called (check logs)
□ Direct session single-track test: confirmed write was called with correct params (check logs)
□ File exists on disk after test run
```

Don't skip the log verification. The model will tell you it completed tasks. The logs will tell you whether it actually called the tools.

---

## Summary

| Habit from cloud models | Required adjustment for local 14B |
|------------------------|----------------------------------|
| Name the action ("search") | Name the exact tool (`web_search`) |
| Describe the output location ("reports folder") | Specify exact parameter name + absolute path |
| Positive instructions only | Add prohibitions for likely failure modes |
| Comprehensive rule set | Maximum 5 rules — rank by criticality |
| Trust the model's implicit schema knowledge | Treat the model as schema-unaware |

The model can do the work. It needs precise instructions to do it reliably. Write SOUL.md as if you're writing a machine-readable specification, not a natural language description of intent.

---

*Field notes from BeroAI | OpenClaw + qwen2.5:14b production operation*
*Applicable to any local LLM in the 7B–14B range used in agentic workflows*
