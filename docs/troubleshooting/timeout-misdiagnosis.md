---
sidebar_position: 1
---

# It's Not the LLM — It's the Tool Catalog: Diagnosing Agent Timeout Misattribution

*Why increasing `timeoutSeconds` won't fix your hanging agent*

---

## The Misdiagnosis

Your agent stops responding. You wait. After 2–5 minutes, you see:

```
LLM request timed out after 120s
```

The natural conclusion: the model is slow. Increase the timeout. Try a faster model. Check GPU utilization.

Wrong diagnosis. The LLM never got the request.

In some configurations, this timeout fires not because the model is thinking — but because the **tool catalog failed to initialize before the first inference call was made**. The model was never invoked. A configuration error upstream blocked the entire pipeline, and the platform reported it as a model timeout because that's the closest error category in the code path.

---

## The Mechanism

When an OpenClaw agent starts a session, it runs an initialization sequence before passing anything to the LLM:

```
Session Start
  → Load agent configuration
  → Initialize tool catalog
      → Validate tools.allow entries
      → Load skill definitions
      → Check group availability
  → Inject system prompt (SOUL.md + bootstrap files)
  → First inference call to LLM
```

The tool catalog initialization step validates every entry in `tools.allow`. If an entry references a tool group that doesn't exist in the current platform version, the initialization **blocks**.

It doesn't fail fast. It doesn't throw an error to the user. It waits — and eventually the session-level timeout fires, which gets reported as an LLM timeout.

---

## The Trigger We Found

In Berry's configuration, we had included `group:email` in `tools.allow` as preparation for a planned SMTP integration:

```json
{
  "agents": {
    "list": [{
      "id": "berry",
      "tools": {
        "allow": ["group:web", "group:files", "group:email"]
      }
    }]
  }
}
```

`group:email` does not exist in OpenClaw v2026.3.2 core. It's a planned feature, not yet shipped.

The result: Berry stopped responding entirely. Every Telegram message was met with silence. After 2+ minutes, `LLM request timed out` appeared in logs. We spent time checking GPU load (normal), Ollama health (normal), SOUL.md (fine), network (fine) — before finding the actual cause.

---

## How to Tell the Difference

The diagnostic split is in the logs, but you have to know where to look:

**Symptom of a real LLM timeout:**
```
[berry] Starting inference...
[berry] LLM request timed out after 120s
```

The "Starting inference" line appears. The model received the request, started processing, and ran out of time.

**Symptom of catalog initialization block:**
```
[berry] warn tools — allowlist contains unknown entries: group:email
[berry] LLM request timed out after 120s
```

The `warn tools` line appears **before** any inference activity. The model was never reached. The timeout fired on the catalog initialization phase.

```bash
# Check for this pattern immediately when facing agent timeout:
openclaw logs --agent berry --limit 100 | grep -E "(warn tools|Starting inference|timed out)"
```

If `warn tools` appears before `Starting inference` — you have a catalog block, not a model timeout.

---

## Why This Matters Beyond Berry

This failure mode appears identical to a compute timeout from the outside. That makes it a trap for operators who:

1. Are running on limited hardware and expect occasional slow responses
2. Have recently upgraded the platform (tool groups can be renamed or deprecated between versions)
3. Are pre-configuring integrations that aren't live yet
4. Have copied a `tools.allow` list from a different agent or project

In each case, the natural response is to tune the model, check the hardware, or increase timeouts — none of which address the actual problem.

---

## The Fix

Simple: only include tool groups that exist and are active in your current platform version.

```json
// Before (broken):
"tools": {
  "allow": ["group:web", "group:files", "group:email"]
}

// After (working):
"tools": {
  "allow": ["group:web", "group:files"]
}
```

Remove any group that:
- Is for an integration you haven't set up yet
- Was valid in a previous platform version
- Came from a template or copied config without verification

If you need the group later, add it when you're ready to configure the integration end-to-end.

---

## Verification Sequence

Before touching `timeoutSeconds` for any agent timeout issue:

```bash
# Step 1: Check for catalog initialization warnings
openclaw logs --agent <agent-id> --limit 100 | grep "warn tools"

# Step 2: If warnings found, identify the unknown entries
openclaw logs --agent <agent-id> --limit 100 | grep "unknown entries"

# Step 3: Validate current config
openclaw config validate

# Step 4: Cross-check tools.allow against available groups
# Available in v2026.3.2: group:web, group:files, group:memory, group:shell
# NOT available: group:email, group:calendar, group:crm
```

Only after confirming no catalog warnings should you consider adjusting `timeoutSeconds`.

---

## The General Pattern

This is an instance of a broader diagnostic principle for layered systems: **timeouts reported at layer N often originate in layer N-1 or N-2**.

When an agent platform reports a model timeout, work backwards:
- Did the model actually receive the request? (check for "Starting inference" log)
- Did the tool catalog initialize cleanly? (check for "warn tools" log)
- Did the session bootstrap complete? (check for bootstrap file load confirmations)

The timeout at the top is the last thing that happened. The cause is usually much earlier in the stack.

---

## Summary

| What it looks like | What it actually is | How to distinguish | Fix |
|-------------------|--------------------|--------------------|-----|
| LLM request timed out | Tool catalog initialization blocked | `warn tools — unknown entries` in logs before `Starting inference` | Remove non-existent tool groups from `tools.allow` |

Increase `timeoutSeconds` only after ruling out everything upstream of the model.

---

*Field notes from BeroAI | OpenClaw v2026.3.2 production operation*
*Applicable to any agent platform with a tool catalog validation phase*
