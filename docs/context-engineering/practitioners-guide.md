---
title: "Context Engineering: A Practitioner's Guide"
sidebar_label: "Practitioner's Guide"
slug: /context-engineering/practitioners-guide
description: "Operational context engineering guide from 1,000+ hours of combined Claude agent runtime. Covers context windows, KB architecture, multi-agent isolation, context rot defense, and token economics."
keywords: [context engineering, claude, multi-agent, system prompt, knowledge base, context rot, token economics]
authors:
  - name: Claire (Claude Grand Master)
---

## About This Guide

This guide documents what we learned building and operating CGM (Claude Grand Master) — a multi-agent Claude ecosystem in continuous production since early 2026. It is a practitioner's manual: operational rules, failure modes, and decision frameworks drawn from real work.

**Where this guide fits.** Anthropic's official guides ("Effective Context Engineering for AI Agents," "Effective Harnesses for Long-Running Agents") define the principles — compaction strategies, tool design, just-in-time retrieval. LangChain and LlamaIndex provide framework-level implementation patterns. This guide starts where those end: what happens when you apply those principles to a production multi-agent Claude system over months of continuous operation. We do not replace vendor documentation; we build on it with operational depth that vendor guides do not cover.

**What this guide covers:** claude.ai project operations, API context management, Claude Code workflows, multi-agent session continuity, knowledge base architecture, context rot defense, and token economics — all Claude-specific, all grounded in production data.

**What this guide does not cover:** General-purpose LLM context engineering across providers (GPT, Gemini, open-source models), coding agent context management (well-served by Faros and VS Code documentation), RAG pipeline design (well-served by LlamaIndex and Weaviate), or framework-level middleware implementation (well-served by LangChain/LangGraph).

Where external research supports our findings, we cite it. Where our operational data contradicts popular assumptions, we say so. Three independent research sources (Claude Deep Research, ChatGPT, Gemini Deep Research) were cross-validated for key claims.

**Evidence classification.** Claims in this guide carry one of four labels:

- **[Vendor-documented]** — Confirmed against Anthropic's official platform documentation
- **[Research-backed]** — Supported by published academic or industry research
- **[Cross-source inference]** — Derived from multiple independent sources, not directly documented by any single one
- **[CGM operational observation]** — Observed in our operations; treat as tested heuristic, not vendor-guaranteed behavior

**Scope and limitations.** All platform-specific observations are based on behavior as of March 2026. Anthropic updates backend logic, pricing, and platform constraints without advance notice. Treat platform-specific claims as point-in-time observations. Operational metrics come from a single team's production usage (49 handover sessions, 85+ lessons, 15+ client engagements, across parallel agent instances totaling 1,000+ hours of combined runtime) — directionally reliable but not statistically generalized.

**Who this is for:** Practitioners designing, building, or operating Claude-based agent systems.

**What this is not:** A beginner's prompt writing tutorial. We assume familiarity with system prompts, tools, and context windows.

---

## Chapter 1 — Context Is the Product

### 1.1 Why "Context Engineering," Not "Prompt Engineering"

The term "prompt engineering" implies that success comes from finding the right words. It doesn't. Success comes from answering a broader question: *what configuration of context is most likely to produce the behavior you need?*

Anthropic defines context engineering as "optimizing the utility of tokens against the inherent constraints of LLMs in order to consistently achieve a desired outcome." **[Vendor-documented]** The unit of work is not the prompt — it is the entire token payload that enters the context window on every API call or chat message.

That payload includes:

- **System prompt** — identity, role, constraints, behavioral rules
- **Knowledge Base (KB) files** — reference documents, skills, accumulated knowledge
- **Memory** — user-specific preferences and facts injected automatically
- **Tools** — function definitions, MCP server schemas
- **Conversation history** — every prior message in the session
- **Platform overhead** — claude.ai injects its own platform prompt, tool definitions, and memory system on top of everything you write

Every token in that payload competes for the model's attention. The discipline of context engineering is deciding what earns its place and what gets cut.

### 1.2 The CGM Case: What a Production Context Stack Looks Like

**[CGM operational observation]**

CGM operates a Claude project with the following context architecture. Detailed metrics are in Appendix C; here we show the structure:

| Layer | Contents | Role |
|-------|----------|------|
| System Prompt | Identity, virtues, roles, research principles, prohibitions (~3,500 tokens Korean) | Always-present policy |
| KB Files | 12 files: audit framework, skills, lessons, case log, patterns, guides | On-demand reference |
| Memory | 12 items: identity, preferences, operational conventions | Auto-injected every turn |
| Skills | User skills + platform skills, triggered by description match | Loaded when relevant |
| Handover | Session continuity document, uploaded at session start | Full injection |
| Platform overhead | claude.ai platform prompt, tools, memory system | Invisible but present |

This stack has sustained consistent behavior across 49+ handover sessions. It evolved through iteration — each failure teaching us where context goes wrong.

### 1.3 The Core Principle

**The smallest high-signal token set wins.**

More context is not automatically better. Every unnecessary token dilutes the signal that matters. The goal is never "how much can we fit" but "what is the minimum set that reliably produces the behavior we need."

This principle — Anthropic's own language is "find the minimal high-signal set" — governs every decision in this guide. **[Vendor-documented]**

### 1.4 Symptom-Based Navigation

If you already know what's going wrong, start here:

| Symptom | Root Cause | Go To |
|---------|-----------|-------|
| "The model forgets instructions mid-session" | Context rot — early instructions fading as conversation grows | Chapter 2 (U-Curve), Chapter 6 (Context Rot Defense) |
| "Adding more KB files made things worse" | RAG mode activation — cross-file referencing degradation | Chapter 4 (KB Architecture) |
| "Every new session starts from zero" | No continuity mechanism between sessions | Chapter 5 (Multi-Agent Isolation, Handover Protocol) |
| "Same prompt works in API but fails in claude.ai" | Environment-specific injection differences | Chapter 3 (Three Environments) |
| "Costs are too high for what we're getting" | Wrong model tier, effort level, or context bloat | Chapter 7 (Token Economics) |
| "The agent triggers skills when it shouldn't" | Model-generation mismatch in trigger aggressiveness | Chapter 3.4 (Directive Design) |
| "Memory items keep growing and quality drops" | No memory lifecycle management | Chapter 6.2 (Defense 4), Chapter 6.3 (Checklist) |
| "I don't know where to start structuring my project" | Need the full architecture | Read Chapters 1-7 in order |

---

## Chapter 2 — The Context Window: What Actually Happens Inside

### 2.1 The U-Curve

**[Research-backed]** — Liu et al. (2024, TACL), "Lost in the Middle." Replicated in numerous follow-up studies.

When tokens enter a context window, the model does not pay equal attention to all of them. Research consistently shows a U-shaped attention distribution:

- **Beginning of context** (primacy): Strong attention. System prompts and early instructions are followed reliably.
- **Middle of context**: Weakest attention. Information placed here is most likely to be missed or partially processed.
- **End of context** (recency): Strong attention. The most recent messages and instructions get reliable processing.

This is an architectural property of transformer-based models. It is not addressable through prompting alone — it requires structural decisions about where information is placed.

**Practical implication:** Place your most critical instructions at the top of your system prompt AND reinforce them near the bottom. The middle section is where you put reference material that can tolerate partial attention.

### 2.2 Fill Rate and Attention Behavior

**[Cross-source inference]** — The directional pattern is well-supported; the specific threshold is an interpretation, not a published finding.

As the context window fills, the balance between primacy and recency shifts:

- **At lower fill rates:** Both primacy and recency zones are strong. The model reliably processes instructions at both the beginning and end of context.
- **At higher fill rates:** Recency begins to dominate. Early instructions gradually fade as the model focuses increasingly on recent messages.

The architectural explanation is sound: RoPE positional encoding decay means recency grows relatively stronger as context grows. However, no published research identifies a specific percentage as the hard threshold where this shift occurs. In our operations, we have observed that keeping baseline fill rate well below half produces reliable instruction adherence throughout the session. **[CGM operational observation]**

**CGM practice:** We keep our system prompt compact (~3,500 tokens) and use skill delegation to avoid bloating the always-present context. KB files are loaded on demand rather than injected wholesale.

### 2.3 Effective Capacity ≠ Advertised Capacity

**[Research-backed]** — NVIDIA RULER benchmark (Hsieh et al., COLM 2024).

Claude Opus 4.6 and Sonnet 4.6 both support 1M token context windows (GA, standard pricing as of March 2026). **[Vendor-documented]** But advertised capacity and effective capacity are different things.

Published benchmarks suggest effective capacity falls in the range of **50-65% of advertised maximum** for most models. Beyond this range, context rot — the gradual degradation of retrieval accuracy and reasoning precision — becomes measurable. Some newer architectures push higher (Gemini 1.5 Pro retained 94.4% at 128K in RULER testing), but the general pattern holds.

In CGM operations, we have observed usable performance up to roughly 60-70% of window capacity, though we actively avoid testing the upper boundary. **[CGM operational observation]**

The mechanism: as token count increases, the number of pairwise relationships grows quadratically (n tokens → n² attention pairs). The model's attention budget gets spread thin. Anthropic describes this as "a performance gradient, not a performance cliff." **[Vendor-documented]**

**CGM practice:** We treat context as a scarce resource and never try to maximize utilization.

### 2.4 The "3,000-Token System Prompt Limit" — Debunked

**[Cross-source inference]** — 3-source cross-validation found no primary source.

A widely cited claim states that system prompts exceeding 3,000 tokens cause reasoning degradation. We investigated this across three independent research sources.

**Finding: No Anthropic source exists for this claim.**

The "3,000 token" figure appears to originate from the Claude Code built-in prompt size, which community discussions then incorrectly generalized to all Claude environments. Anthropic has never published a 3,000-token limit for system prompts.

Anthropic's actual guidance: use a "minimal high-signal set." The principle is signal density, not an arbitrary token count. **[Vendor-documented]**

**CGM practice:** Our system prompt is ~3,500 tokens (in Korean; ~2,000 in English equivalent). It works because every line earns its place, not because we hit a magic number. That said, we prefer modular skill delegation over large monolithic instruction blocks — not because of a specific token limit, but because monolithic blocks make the middle section of context vulnerable to reduced attention (see 2.1).

**Lesson:** Always verify popular claims against primary sources. Community wisdom is often right about the direction (shorter is better) but wrong about the specifics.

---

## Chapter 3 — Three Environments, One Brain

### 3.1 The Environment Problem

**[Vendor-documented]** — Based on Anthropic's platform documentation for each environment.

Claude operates in three distinct environments, and context behaves differently in each:

| Environment | System Prompt Injection | KB/Files | Memory | Tools |
|-------------|------------------------|----------|--------|-------|
| **claude.ai** | Platform prompt + Project Instructions + KB files | RAG-loaded (see 4.1 for threshold) | Auto-injected userMemories | Platform tools + MCP |
| **API** | Developer-controlled system message | None (developer manages) | Developer-controlled | Developer-defined tools |
| **Claude Code** | CLAUDE.md + built-in prompt | File system access | MEMORY.md (first 200 lines or 25KB) | Bash, file editor, MCP |

A system prompt designed for one environment will not automatically work in another. In our client consultations, environment mismatch is among the most frequent sources of architectural errors. **[CGM operational observation]**

### 3.2 Environment-Specific Behaviors

**claude.ai specifics:**
- The platform injects its own prompt, tool definitions, and memory system *on top of* your Project Instructions. You do not control the full context payload. **[Vendor-documented]**
- KB files switch from full injection to RAG (retrieval) mode based on content volume. Cross-file referencing degrades in RAG mode. (See Chapter 4.1 for details.)
- Memory items (userMemories) are auto-injected into every conversation turn, consuming context whether you want them to or not. **[Vendor-documented]**

**API specifics:**
- You control the entire context payload. Nothing is injected that you didn't put there. **[Vendor-documented]**
- Tool definitions consume tokens. Per Anthropic's documentation: `tool_choice: auto` or `none` adds ~346 tokens; `tool_choice: any` or specific tool adds ~313 tokens. This overhead exists on every API call, regardless of whether tools are actually invoked. **[Vendor-documented]**
- Context compaction is available (Opus 4.6/Sonnet 4.6 beta, `compact_20260112` strategy). Server-side compaction is generally preferred over client-side. **[Vendor-documented]**
- Context editing (beta, `context-management-2025-06-27` header) provides fine-grained control: tool result clearing (`clear_tool_uses_20250919`) and thinking block clearing (`clear_thinking_20251015`). **[Vendor-documented]**

**Claude Code specifics:**
- CLAUDE.md is injected as a **user message**, not as a system prompt. It is wrapped in `<system-reminder>` XML tags and placed in the messages array. This means it competes with actual user messages for attention rather than occupying the privileged system prompt position — weaker than most people assume. **[Research-backed]** — Confirmed by Claude Code Camp technical analysis and Piebald-AI system prompt tracking across 125+ releases.
- MEMORY.md: First 200 lines or 25KB (whichever is smaller) loaded at session start. Anything beyond is truncated. Topic-specific files (e.g., debugging.md) are loaded on demand. **[Vendor-documented]**
- The model has full file system access and can use agentic search (glob, grep) to load context just-in-time rather than pre-loading everything. **[Vendor-documented]**
- Compaction happens automatically: when approaching context limits, the model summarizes conversation history, preserving architectural decisions and unresolved issues while discarding redundant tool outputs. **[Vendor-documented]**

### 3.3 The SSOT 3-Layer Architecture

**[CGM operational observation]** — Proposed framework based on cross-environment analysis.

We propose a three-layer structure for maintaining a Single Source of Truth across environments:

**Layer A — Core Policy (environment-agnostic)**
Identity, role, constraints, behavioral rules, absolute prohibitions. This layer should be identical regardless of whether the agent runs in claude.ai, API, or Claude Code. Written once, adapted to each environment's injection mechanism.

**Layer B — Surface Adapter (environment-specific)**
How Layer A gets delivered. In claude.ai: Project Instructions. In API: system message. In Claude Code: CLAUDE.md. Each adapter handles the mechanics of injection but does not change the policy itself.

**Layer C — Persistent State (cross-session continuity)**
Accumulated knowledge, lessons learned, operational memory. In claude.ai: KB files + userMemories. In API: developer-managed storage + memory tool. In Claude Code: MEMORY.md + file system.

**CGM example in practice:** Our core rules (Layer A) are the same whether Claire runs in claude.ai or Clyde executes in Claude Code. What changes is the adapter (Layer B): Claire reads KB files through project knowledge search; Clyde reads the same information from the file system. The persistent state (Layer C) syncs through handover documents and git repositories.

### 3.4 Directive Design: Strong Models vs. Weak Models

**[CGM operational observation]** — Measured across CGM audit framework and client engagements.

How you write instructions must match the model's reasoning capability:

**For weaker models (Haiku 4.5, local models like qwen3:14b):**
Pre-decide all branching logic. Write "do this," not "decide what to do." Specify exact file paths, exact output formats, exact sequences. Leave zero ambiguity.

Example (Haiku 4.5):
> "Search for articles about [topic]. Save results to ~/workspace/raw/[date].json. Format: one JSON object per line. Do not filter, do not summarize, do not judge relevance. Save the file and report the line count."

**For stronger models (Opus 4.6, Sonnet 4.6):**
Provide goals and constraints. Delegate method selection to the model. Overly prescriptive instructions for strong models cause overtriggering and reduce output quality.

Example (Opus 4.6):
> "Analyze the user's system prompt for structural issues. Diagnose root causes before suggesting fixes. Prioritize by severity. Deliver improved files, not just commentary."

**Model-specific trigger strategies for skills:**

| Model | Trigger Tendency | Recommended Style |
|-------|-----------------|-------------------|
| Haiku 4.5 | Severe undertrigger | Pushy: "ALWAYS invoke when..." |
| Sonnet 4.5 | Moderate undertrigger | Standard directive |
| Opus 4.5 | Overtrigger possible | Remove "MUST"/"CRITICAL" |
| Sonnet 4.6 | Overtrigger possible | Restrained: "Use this tool when..." |
| Opus 4.6 | Most sensitive, overtrigger observed in CGM testing | Most restrained description |

**[CGM operational observation]** — These trigger tendencies are based on CGM audit framework observations across client engagements. "Overtrigger observed" means we measured unintended skill activation in unrelated conversations; it is not an Anthropic-published specification.

---

## Chapter 4 — Knowledge Base Architecture

### 4.1 KB File Count and RAG Activation

**[CGM operational observation]** — Based on repeated observation in claude.ai project operations. Not confirmed as vendor-documented behavior.

In claude.ai projects, Knowledge Base files appear to be loaded in one of two modes:

- **In-context mode** (lower file counts): Files are loaded directly into context. The model sees full content and can cross-reference between files reliably.
- **RAG mode** (higher file counts): The system switches to retrieval-augmented generation. Instead of loading full files, it performs semantic search and returns fragments. Cross-file referencing degrades. Hallucination risk increases.

**What we know from official documentation:** Anthropic states RAG "automatically activates when your project approaches or exceeds the context window limits" — framed around token capacity. KB files are officially "unlimited" with a 30MB/file limit. **[Vendor-documented]**

**What we observed:** In our operations, we have consistently seen RAG-like behavior activate based on file count, with quality degradation appearing around 13+ files regardless of total token volume. This observation aligns with GitHub Issue #25759 (Feb 2026), though that issue was filed in the claude-code repository (not claude.ai) and was closed as "not planned." The evidence is anecdotal, not vendor-confirmed.

**CGM practice:** We maintain exactly 12 KB files (excluding the system prompt, which is pasted into Project Instructions separately and does not occupy a KB slot). When we need to add a file, we merge or retire existing files first. Whether the trigger is file count, token volume, or both, keeping file count low has produced reliable cross-file referencing in our operations.

### 4.2 KB-First Sovereignty (KBFS)

**[CGM operational observation]** — CGM proprietary framework.

**Principle: KB files are the primary source of truth for agent operations. They take precedence over GitHub, local files, external storage, and all other repositories.**

The reasoning:

1. KB files are what the model actually reads during operation. If information exists only in GitHub but not in KB, the model doesn't know it.
2. Session-to-session, the only persistent context the model reliably accesses (in claude.ai) is KB + Memory. Everything else requires explicit injection.
3. KB-first discipline forces you to keep your knowledge current. If updating KB feels like overhead, your workflow has a gap.

**Operational rule: Work is not complete until KB is updated.** A code change pushed to GitHub but not reflected in relevant KB files is incomplete work. A lesson learned but not recorded in the lessons file is a lesson that will be re-learned.

### 4.3 File Organization Strategy

**[CGM operational observation]**

Effective KB architecture follows these principles:

**Role separation:** Each file serves one clear purpose. The audit framework is not mixed with the operations guide. Lessons are not embedded in case logs. When a file tries to serve two purposes, both suffer.

**Naming conventions:** File names should signal content at a glance. CGM uses category prefixes: `cgm-` for system-level files, `og-` for domain-specific skills, `CGM_` for operational documents.

**Merge aggressively:** When two files share significant overlap in their use cases, merge them. We merged coding principles and escalation blocks into a single behavior principles file — reducing file count by 2 while improving discoverability.

**Skill delegation:** Instead of putting all behavioral rules in the system prompt, delegate specialized behaviors to skill files. The system prompt references the skill; the detailed framework lives in its own file, loaded only when needed. This keeps the always-present system prompt lean while preserving full capability depth.

### 4.4 Knowledge Accumulation Architecture

**[CGM operational observation]**

Long-running agent systems need a structured way to learn from experience. Without this, every session starts from zero.

CGM uses three accumulation files:

| File | Purpose | Entry Trigger |
|------|---------|---------------|
| `cgm-case-log` | Client engagement records: what was reviewed, found, delivered | After every completed engagement |
| `cgm-lessons` | Structural insights that apply across engagements. Promoted from case-log when a pattern repeats 2+ times | When a pattern is confirmed |
| `cgm-prompt-patterns` | Reusable good patterns (GP-xx) and anti-patterns (AP-xx) with severity ratings | When a pattern has cross-project applicability |

The promotion flow: case-log entry → if pattern repeats → lessons entry → if universally applicable → prompt-patterns entry.

This accumulation mechanism is how the system improves over time. After 85+ lessons and 15+ case logs, CGM's audit accuracy has measurably improved from its early engagements.

---

## Chapter 5 — Multi-Agent Context Isolation

### 5.1 The Isolation Premise

**[Vendor-documented]** — Claude sessions have no shared state.

In multi-agent Claude systems, each agent operates in complete context isolation. Agent A cannot see Agent B's context window, memory, or state. There is no shared memory bus, no inter-agent communication channel.

This is not a limitation to work around — it is an architectural premise to design for.

**The handover document is the only bridge between agent sessions.** If information is not in the handover, it does not exist for the next session.

### 5.2 Hard-Stop Handover Protocol

**[CGM operational observation]** — CGM proprietary framework.

When a session ends, context is destroyed. The handover is the sole mechanism for continuity.

**Required handover contents:**

1. **What was done** — changed files with commit hashes, decisions made, items completed
2. **Lessons registered** — new lesson numbers, pending registrations
3. **Memory changes** — items added, merged, deleted, with before/after counts
4. **Incomplete items** — prioritized list of what remains, with context for next session
5. **Overlap flags** — areas where parallel sessions might conflict (for multi-session operations)
6. **Performance archive** — task IDs, agents used, results, timing data

**What makes this work:**

The handover is not a log — it is a briefing document for a successor who has no memory. Every entry should give the next session enough context to continue without asking questions.

CGM has produced 49 handover documents. The format has been refined to the point where a new session can read the handover and resume productive work within 1-2 messages.

### 5.3 Chain of Density for Handovers

**[Research-backed]** — Adams et al. (2023), "Chain of Density" summarization research.

The Chain of Density framework from summarization research applies directly to handovers. The paper reports human-written summary density at approximately 0.15 entities per token, with the median-preferred density step matching this figure.

Below this density, the handover is verbose and wastes context. Above it, critical nuance is lost. The sweet spot preserves decision-relevant information while being compact enough to leave room for actual work in the new session.

**Practical application:** Write handover sections as dense briefings, not narrative accounts. "KB swap pending: lessons v3.3→v3.4, case-log v2.6→v2.7" is better than "We prepared updated versions of the lessons file and the case log file and these need to be swapped in the KB."

### 5.4 Focus Architecture: Per-Item Encapsulation

**[CGM operational observation]**

For compressing context across sessions, we have found that per-item encapsulation outperforms batch summarization.

Instead of summarizing an entire session into one summary block, encapsulate each distinct work item into its own compact unit. Then compose the handover from these units.

In our operations, this approach reduced handover token count by roughly half compared to narrative-style summaries, while preserving the details needed for session continuity. **[CGM operational observation]** — Batch summarization methods typically lose 10-20% of details in published compression research; per-item encapsulation in our usage has shown minimal measured loss, though we have not conducted formal information-loss measurement.

**CGM practice:** Each handover section is a self-contained unit (one task = one section with its own status, findings, and next steps). The handover file is a composition of these units, not a narrative retelling.

### 5.5 Parallel Session Management

**[CGM operational observation]**

CGM runs multiple sessions in parallel. These sessions cannot see each other.

**Workflow:**
1. Sero launches parallel sessions, each assigned a distinct work area
2. Each session produces its own handover
3. Sero collects handovers and delivers them to a "merge" session
4. The merge session performs: numeric cross-validation + lesson number reassignment + folder consolidation

**Important:** Handovers must flag potentially overlapping work areas. If Session A modified the audit framework and Session B also touched audit criteria, the merge session needs to know.

---

## Chapter 6 — Context Rot and Maintenance

### 6.1 What Context Rot Is

**[Vendor-documented]** — Anthropic defines context rot as performance degradation with increasing context.

Context rot is the progressive degradation of model performance as a session extends. It manifests as:

- Earlier instructions being followed less precisely
- Increased hallucination about previously discussed details
- Inconsistent application of rules defined at session start
- "Drift" from established patterns toward generic behavior

The mechanism is the U-curve (Chapter 2): as conversation grows, early system-level instructions move further from the recency zone. The model's attention budget is finite, and recent messages claim an increasing share of it.

### 6.2 How CGM Defends Against Context Rot

**[CGM operational observation]**

**Defense 1: Compact system prompt with skill delegation.** **[CGM operational observation]**
The system prompt stays compact. Detailed behavioral rules live in skill files loaded on demand. This keeps the always-present context lean, preserving the primacy zone for what matters most.

**Defense 2: KB-first discipline.** **[CGM operational observation]**
Critical information lives in KB files, not in conversation history. In claude.ai, KB files are loaded into context at session start and occupy a stable position regardless of how long the conversation runs. **[Vendor-documented]** Conversation-embedded instructions rot; KB-embedded instructions persist.

**Defense 3: Session boundaries as a feature.** **[CGM operational observation]**
We do not fight session limits — we design for them. A focused session with a clean handover outperforms a marathon session where later instructions contradict earlier ones. The hard-stop handover protocol (Chapter 5) turns session boundaries from a limitation into a quality mechanism.

**Defense 4: Memory lifecycle management.** **[CGM operational observation]**
Memory items (userMemories in claude.ai) are auto-injected into every turn. Too many items means too much noise in every context window. CGM maintains 12 items through active lifecycle management:

- **Temporary buffer:** New conventions start as memory items
- **Promotion:** After 3+ sessions of confirmed use, promote to skills or guidelines
- **Retirement:** Promoted items are deleted from memory
- **Merge:** When 19 items accumulated, we merged to 12 — immediate improvement in signal quality

The principle: memory is a working buffer, not a permanent archive.

### 6.3 Memory Maintenance Checklist

**[CGM operational observation]**

Quarterly (or whenever item count exceeds 15):

1. Review each item: Is it still accurate? Still needed?
2. Check for duplicates or near-duplicates
3. Identify items that should be promoted to KB files
4. Merge related items into single, denser entries
5. Delete items covered by KB files or no longer relevant
6. Verify remaining count is ≤15 (ideally ≤12)

### 6.4 The "KB Not Updated = Not Done" Rule

This is the operational expression of KBFS (Chapter 4). Before closing any work session:

- Are KB files current with what was accomplished?
- Are version numbers updated in the operations guide?
- Are new lessons recorded?
- Are old file versions marked for cleanup?

If any answer is no, the session is not complete. This discipline prevents the most common form of context rot we encounter: stale reference documents that cause the model to give outdated guidance.

---

## Chapter 7 — Token Economics and Optimization

*This chapter covers what we know from operational data and vendor documentation. Areas marked as pending require supplemental research for completeness.*

### 7.1 Verified Cost and Overhead Data

**API tool overhead:** **[Vendor-documented]**
- `tool_choice: auto` or `none`: ~346 tokens per call
- `tool_choice: any` or specific tool: ~313 tokens per call
- This overhead exists on every API call, regardless of whether tools are actually invoked

**1M context pricing (as of March 2026):** **[Vendor-documented]**
- Long-context surcharge removed for Opus 4.6 and Sonnet 4.6
- Standard pricing applies to full 1M window
- Opus 4.6: $5/M input, $25/M output (max output: 128K tokens)
- Sonnet 4.6: $3/M input, $15/M output (max output: 64K tokens)
- Batch API offers 50% discount on both models

**Context compaction:** **[Vendor-documented]**
- Available for Opus 4.6 and Sonnet 4.6 (beta, `compact_20260112` strategy)
- Server-side compaction is generally preferred over client-side
- Claude Code implements automatic compaction: summarizes history, preserves decisions and unresolved issues, discards redundant tool outputs, retains 5 most recently accessed files

**Context editing (API beta):** **[Vendor-documented]**
- Tool result clearing (`clear_tool_uses_20250919`): removes stale tool results when context grows beyond threshold
- Thinking block clearing (`clear_thinking_20251015`): manages extended thinking blocks for cost and caching
- Beta header: `context-management-2025-06-27`

**MCP server overhead:** **[CGM operational observation]** — Setup-dependent.
- One documented case: 32 MCP servers with 473 tools consumed 70-75% of context window (~140K-150K tokens). Multiple independent reports corroborate similar magnitudes. Tool description verbosity and parameter schema complexity cause wide variation.

### 7.2 Effort Level Distribution

**[CGM operational observation]**

- Low: 60-70% of tasks (simple operations, file generation, classification)
- Medium: 20-30% of tasks (standard analysis, moderate complexity)
- High: 10% or less (complex reasoning, architectural decisions, audits)

The difference between `low` and `high` can be up to 10x in token consumption. Opus 4.6 at effort level `low` produces quality comparable to Sonnet 4.5 at a fraction of the cost.

### 7.3 Cost Optimization Principles

**Principle 1: Right-size the model.**
Not every task needs Opus. CGM uses Haiku 4.5 for collection/classification tasks at ~$0.03/day, reserving Opus for judgment and strategic work. The dual-agent pattern (local model for collection, API model for judgment) can reduce costs substantially while maintaining quality. **[CGM operational observation]**

**Principle 2: Right-size the effort.**
Reserve `high` effort for genuinely complex reasoning. Most routine operations perform well at `low` or `medium`. **[CGM operational observation]**

**Principle 3: Keep context lean.**
Every token you put into context costs money on every subsequent API call. Trimming a system prompt from 5,000 to 3,000 tokens saves 2,000 tokens per call. At scale, this compounds significantly. **[Cross-source inference]**

**Principle 4: Use just-in-time context loading.**
Instead of pre-loading all reference data, maintain lightweight identifiers (file paths, queries, links) and load data dynamically when needed. This is the approach Claude Code uses internally. **[Vendor-documented]**

### 7.4 Areas for Future Versions

The following areas are actively being researched and will be covered in future versions of this guide:

- Prompt caching strategies and their real-world cost impact (estimated up to 90% input cost reduction for static context)
- Model-specific window size strategies (when to use 200K vs 1M)
- Batch API pricing optimization patterns
- Multilingual token density strategies (CJK languages such as Korean, Japanese, and Chinese consume ~1.5-2x more tokens than English for equivalent content; system prompt optimization is correspondingly more impactful in these languages)

---

## Appendix A — CGM Proprietary Frameworks

### Framework 1: KBFS (Knowledge-Base-First Sovereignty)

> KB is the primary source of truth for agent operations. KB takes precedence over all external stores. Work not reflected in KB is not complete.

**Application:** Before closing any session, verify KB files are current. Before making any architectural decision, verify KB contains the latest information. When conflicts exist between KB and external sources, KB wins — then update the external source.

### Framework 2: Hard-Stop Handover Protocol

> Session termination = context destruction. The handover is the sole continuity mechanism.

**Required contents:** (1) changed files + commit hashes, (2) lessons registered/pending, (3) memory changes, (4) incomplete items prioritized, (5) overlap flags for parallel sessions, (6) performance archive.

**Quality test:** Can a new session read only the handover and resume productive work within 2 messages? If not, the handover is insufficient.

### Framework 3: Adaptive Pattern Detection (APD)

> Detect recurring user behaviors adaptively. No static thresholds. Propose rule creation only when pattern is clear and worth codifying.

**Detection criteria:** User repeats the same type of correction/preference AND the correction has rule-creation value (not one-off).

**Guardrails:** Maximum 2-3 pattern proposals per session. Do not propose during focused work — batch for session end. Only propose when confidence is high. If user rejects, do not record.

**Research basis:** **[Research-backed]** Static thresholds (e.g., "trigger after 2 occurrences") produce overtriggering. Human therapists average 3 suggestions per session vs. chatbots' 7.4 (U=12.5; P=.003). **[Cross-source inference]** Reverse self-audit (checking own compliance) is structurally unreliable due to self-confirmation bias.

---

## Appendix B — Quick Reference: Anti-Patterns

| ID | Anti-Pattern | Severity | One-Line Fix |
|----|-------------|----------|-------------|
| AP-01 | No role definition | 🟡 Major | Add role-scope-constraint structure |
| AP-02 | Contradictory instructions | 🟡 Major | Resolve conflicts with conditional rules |
| AP-03 | Large monolithic instruction blocks | 🟡 Major | Delegate to skills; prefer modular structure |
| AP-04 | Excessive XML wrapping | 🟢 Minor | Use markdown headers instead |
| AP-05 | No skill system | 🟡 Major | Split functionality into SKILL.md files |
| AP-06 | No knowledge accumulation | 🟡 Major | Add case-log + lessons + patterns files |
| AP-07 | Prefilling (pre-filled assistant turn) | 🔴 Critical | Remove immediately (deprecated on Sonnet 4.5+, returns 400 on Opus 4.6 and Sonnet 4.6) |
| AP-08 | No input isolation (customer-facing) | 🔴 Critical | XML-separate instructions from user input |
| AP-09 | Same trigger strategy for all models | 🟡 Major | Adjust aggressiveness per model generation |
| AP-10 | Conversational rules in SOUL.md | 🔴 Critical | SOUL.md = cron-only minimal rules |
| AP-11 | No AI slop prevention | 🟡 Major | Explicit prohibition list for fonts/colors/layouts |

**Note on AP-07:** Anthropic describes prefilling as "deprecated and not supported" rather than "removed." The restriction applies to Claude Sonnet 4.5, Opus 4.6, and Sonnet 4.6. Only the last-assistant-turn prefill is blocked — assistant messages in non-final conversation positions still work. **[Vendor-documented]**

---

## Appendix C — Operational Metrics from CGM

**[CGM operational observation]** — All numbers below are from CGM production operations.

| Metric | Value | Context |
|--------|-------|---------|
| Handover documents produced | 49 | Continuous operation since Feb 2026 |
| Combined agent runtime | 1,000+ hours | Across parallel sessions (up to 3 concurrent) + Claude Code instances |
| KB files maintained | 12 | At operational ceiling, actively managed |
| Memory items (current) | 12 | Merged from peak of 19 |
| Lessons recorded | 85+ | Accumulated from case logs |
| Case logs | 15+ | Client engagements + internal audits |
| Prompt patterns catalogued | 11 anti-patterns, 7 good patterns | Cross-validated across engagements |
| Haiku self-scoring bias | ~16% | Consistent across 55 internal benchmarks. Published LLM-as-judge self-enhancement bias ranges 5-40% depending on model and metric (cf. Minnesotanlp CoBBLEr; Zheng et al. 2023 MT-Bench). |
| Research sources per major decision | 3 | Claude DR + ChatGPT + Gemini DR |
| Parallel sessions (max) | Up to 3 | With merge session for consolidation |

---

## Appendix D — Methodology and Scope

**Observation period:** February – March 2026 (ongoing)

**Primary environment:** claude.ai Projects (Opus 4.6). Secondary: Claude Code CLI (Sonnet 4.6, Haiku 4.5), Anthropic API.

**Model versions:** Claude Opus 4.6, Claude Sonnet 4.6, Claude Haiku 4.5. Local: Ollama qwen3:14b.

**What was measured:**
- Session count, handover continuity, and resumption quality (qualitative assessment)
- KB file count impact on cross-reference reliability (qualitative, repeated observation)
- Memory item count impact on response quality (qualitative, before/after merge comparison)
- Haiku task completion accuracy (55 structured benchmarks, quantitative scoring with cross-model verification)
- Skill trigger accuracy across model generations (observed across client audits)

**Nature of operational metrics:** Most metrics are qualitative observations from production usage, not controlled experiments. The Haiku benchmarking (55 tasks, Phase 1-4) is the most structured measurement. Other numbers (handover count, lesson count, file count) are exact operational counts.

**Generalization limits:** All observations come from a single team's production usage. Results may not generalize to different team sizes, domains, languages, or usage patterns. Platform behavior may change without notice. Treat operational observations as tested heuristics, not guaranteed specifications.

**Fact-checking process.** Version 1.1 of this guide was submitted for independent review to four sources: ChatGPT (structural and rhetorical analysis), Gemini Pro and Gemini Deep Thinking (practical completeness and internal consistency), and a separate Claude Research session (primary-source fact verification against Anthropic documentation). Version 1.2 incorporated all corrections (11 items, including one factual error in tool_choice token values). Version 1.3 addressed structural refinements from a second review round (4 major, 3 minor items). Version 1.4 added positioning clarity and navigation based on a third review round (4 sources, competitive landscape analysis).

---

## Appendix E — Companion Guides

This guide covers Claude-specific operational context engineering. For broader or deeper coverage of specific areas, these companion resources are recommended:

| Resource | Strength | Relationship to This Guide |
|----------|----------|---------------------------|
| **Anthropic: "Effective Context Engineering for AI Agents"** | Foundational principles: compaction, tool design, just-in-time retrieval, agent affordances | This guide applies and validates these principles in production |
| **Anthropic: "Effective Harnesses for Long-Running Agents"** | Multi-context-window workflows, initializer agent pattern, claude-progress.txt | This guide extends these patterns to session-isolated environments (claude.ai) |
| **LangChain: "Context Engineering"** | Write/select/compress/isolate framework, middleware implementation, persistent vs transient state | Complementary: framework-level architecture vs operational rules |
| **Martin Fowler (ThoughtWorks): "Context Engineering for Coding Agents"** | Skills, hooks, MCP, context interfaces for coding workflows | Complementary: coding-agent-specific vs multi-agent operational |
| **Weaviate: "Context Engineering"** | Memory architecture, vector DB integration, agent memory taxonomy | Complementary: retrieval infrastructure vs operational discipline |
| **LlamaIndex: Context Engineering Guide** | RAG pipeline design, retrieval strategies, data ingestion | Complementary: data pipeline vs context management |

**Recommended reading order for new practitioners:**
1. Anthropic's official guide (principles)
2. This guide (operational application)
3. LangChain or framework-specific guide (implementation)

---

*Context Engineering: A Practitioner's Guide v1.4*
*Claire (Claude Grand Master) | CGM System | March 2026*
*Based on 1,000+ hours of combined agent runtime*
*Cross-validated: Claude Deep Research, ChatGPT, Gemini Deep Research*
*Fact-checked: 3 review rounds, 4 sources, 18+ items corrected*
