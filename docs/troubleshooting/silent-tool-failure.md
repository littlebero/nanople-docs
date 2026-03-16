---
sidebar_position: 2
---

# When Your Agent Lies to You: Why Tool Calls Fail Silently in Local LLMs

*Agent not saving files? Tool call not working? Here's the operational breakdown — qwen2.5:14b in production*

---

## The Problem Nobody Talks About

Your agent says it saved the file. The file doesn't exist.

No error. No warning. No retry. The model generated a `write` tool call, the platform acknowledged it, the agent moved on — and nothing was written to disk.

This is **parameter hallucination with silent failure**, and it's one of the most dangerous operational patterns in local LLM agent deployments. It's dangerous precisely because it's invisible.

---

## What's Actually Happening

When a local LLM like qwen2.5:14b generates a tool call, it doesn't read your tool schema at inference time. It generates parameter names based on its **training data priors** — the statistical distribution of how similar tools were described in the text it was trained on.

The result: the model produces a syntactically valid tool call with the wrong parameter names.

```json
// What qwen2.5:14b generates (wrong):
{
  "tool": "write",
  "parameters": {
    "file_path": "/Users/sero/.openclaw/workspace-berry/reports/2026-03-13.md",
    "content": "# Daily Brief\n..."
  }
}

// What the write tool actually expects (correct):
{
  "tool": "write",
  "parameters": {
    "path": "/Users/sero/.openclaw/workspace-berry/reports/2026-03-13.md",
    "content": "# Daily Brief\n..."
  }
}
```

`file_path` vs `path`. One character difference in the key name. The tool call fails. The model has no idea.

---

## Why It's Silent

Most agent platforms — including OpenClaw — do not return verbose schema validation errors to the model when a tool call fails due to incorrect parameters. The platform rejects the call internally, returns a generic failure or empty result, and the model interprets this as "I tried, nothing happened" rather than "I made an error."

The model's next action depends on its SOUL.md and the context at that point. In many cases it will:
1. Continue to the next task as if the write succeeded
2. Or generate a brief note like "file saved" in its text output

Neither surfaces the failure.

---

## The Three Variants We've Encountered

Through production operation of Berry (7-track research agent, qwen2.5:14b via Ollama), we've identified three distinct failure patterns:

### Variant 1 — Wrong Parameter Name
The most common. Model substitutes a semantically plausible parameter name from training.

| Tool | Expected | Hallucinated | Frequency |
|------|----------|--------------|-----------|
| `write` | `path` | `file_path` | Very common |
| `web_search` | `query` | `search_query` | Occasional |
| `read` | `path` | `filepath`, `file` | Occasional |

### Variant 2 — Tilde Path Expansion
Model uses `~/.openclaw/...` or `$HOME/.openclaw/...` — both fail silently because the tool doesn't expand shell variables.

```
// These all fail:
"path": "~/.openclaw/workspace-berry/reports/2026-03-13.md"
"path": "$HOME/.openclaw/workspace-berry/reports/2026-03-13.md"

// Only this works:
"path": "/Users/sero/.openclaw/workspace-berry/reports/2026-03-13.md"
```

### Variant 3 — Narrative Fallback
The most subtle. Instead of calling the tool at all, the model writes a text description of what it *would* write:

```
"I'll save the research results to the reports directory: 
# Track 3: Capital Flow
[full report content as plain text in model output]
The file has been saved to ~/.openclaw/workspace-berry/reports/"
```

The model generated the content, described a write operation, and produced no tool call whatsoever. The platform logs show zero write attempts.

---

## How We Detected It

The failure was invisible in normal operation. We only found it because:

1. **Telegram output existed but no files on disk** — the model was generating content and sending it to Telegram, but the write step was silently skipped
2. **Inspecting the raw tool call JSON** in platform logs — `openclaw cron runs --id <jobId>` showed the model's actual tool invocations, where we could see `file_path` instead of `path`
3. **Manual verification step** added to our Cron health check — after each run, check that the expected file exists in the reports directory

```bash
# Diagnostic: check if this morning's report was actually written
REPORT="${HOME}/.openclaw/workspace-berry/reports/$(date +%Y-%m-%d).md"
if [ ! -f "$REPORT" ]; then
  echo "⚠️ Report not found — possible silent write failure"
  # Trigger alert
fi
```

---

## The Fix: Explicit Schema Enforcement in SOUL.md

The solution is to treat the model as if it doesn't know your tool schema — because it doesn't.

In your agent's SOUL.md, don't just name the tool. Specify the exact parameter names, types, and format constraints:

```markdown
## File Operations

When saving research output, use the `write` tool with these exact parameters:

- Parameter name: `path` (NOT `file_path`, NOT `filepath`)
- Parameter name: `content`
- Path format: absolute path only. Example: /Users/sero/.openclaw/workspace-berry/reports/YYYY-MM-DD.md
- Do NOT use `~` or `$HOME` — these will not expand and the write will fail silently.

Correct tool call:
{
  "tool": "write",
  "parameters": {
    "path": "/Users/sero/.openclaw/workspace-berry/reports/2026-03-13.md",
    "content": "..."
  }
}
```

This is verbose. It's necessary. A 14B parameter model will override your schema with its training priors every time unless you make the correct behavior more explicit than the wrong behavior feels natural.

---

## Additional Mitigations

### 1. Disable Streaming (`stream: false`)
Ollama's default streaming mode has a known issue where tool calls can be dropped from the response. Disabling streaming ensures the full tool call JSON is transmitted:

```json
// In openclaw.json:
{
  "agents": {
    "list": [{
      "id": "berry",
      "model": {
        "id": "ollama/qwen2.5:14b",
        "options": {
          "stream": false
        }
      }
    }]
  }
}
```

### 2. Explicit Tool Call Mandate in SOUL.md
Add a rule that prohibits the model from describing actions it should take:

```markdown
Rule: A write operation is only complete when the `write` tool has been called.
Describing what you will write, or what you wrote, is not a substitute for calling the tool.
If you cannot call the tool, report an error. Do not generate placeholder text.
```

### 3. Post-Run Verification
Add a verification step after critical tool operations. For file writes, check file existence. For Telegram sends, check delivery logs — `status: "ok"` from `sessions_send` does not guarantee channel delivery.

---

## Broader Implications

This pattern is not unique to qwen2.5:14b. Any local LLM in the 7B–14B range trained primarily on conversational data will exhibit some degree of schema drift. The degree varies:

- **qwen2.5:14b**: High drift on file operations, moderate on search
- **qwen3:14b**: Significantly better (F1 0.971 vs 0.812 in Docker's June 2025 evaluation)
- **Models < 8B**: Should not be used for tool-calling agent work — context window insufficient for full system prompt

The academic literature calls this "Tool Format Hallucination" (Xu et al., ICML 2024) and "Knowledge Conflicting Hallucination" (FORGE '26). The research describes the problem well. What it doesn't provide is the operational playbook for dealing with it in a production agent system — which is what this document is.

---

## Summary

| Problem | Root Cause | Detection | Fix |
|---------|-----------|-----------|-----|
| Wrong parameter name | Training data priors override schema | Log inspection (raw tool call JSON) | Explicit parameter names in SOUL.md |
| Tilde path failure | No shell expansion in tool layer | File existence check | Hardcoded absolute paths in SOUL.md |
| Narrative fallback | Model prefers text over tool calls | Zero tool calls in log | Explicit tool mandate + `stream: false` |

If you're running a local LLM agent that writes files, sends messages, or calls any external API — and you haven't verified the tool call JSON in your platform logs — you may be running an agent that thinks it's working but isn't.

Check your logs. Check your outputs. Assume nothing.

---

*Field notes from BeroAI | OpenClaw + qwen2.5:14b production operation*
*Cross-referenced: Docker LLM Tool Calling Evaluation (June 2025), BFCL V4, Xu et al. ICML 2024*
