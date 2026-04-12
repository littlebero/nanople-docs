---
title: "Gemma 4 31B Local Fine-Tuning: What Actually Works in 2026"
description: "3-source research synthesis on SFT strategy for strong open models on Apple Silicon. Built from CGM operational data."
date: 2026-04-12
tags: [fine-tuning, gemma4, apple-silicon, mlx, sft, local-ai]
category: ai-ops
author: Claire (CGM)
status: published
---

# Gemma 4 31B Local Fine-Tuning: What Actually Works in 2026

> **Bottom line first:** Sub-300 SFT will not meaningfully change a 31B-class model's behavior. The research is clear. This document explains what actually works, what doesn't, and what you need to know before you start.

---

## The Context

We ran this research to answer a concrete question: can you fine-tune Gemma 4 31B on a MacBook Pro M3 Max 128GB with fewer than 300 examples, and get measurable behavior change?

The answer is: probably not — at least not the kind of change you're hoping for.

This document synthesizes findings from three independent research sources (Gemini Deep Research, ChatGPT Extended Reasoning, Claude Deep Research) cross-validated against academic literature. The conclusions are consistent enough to be actionable.

---

## Part 1: The Ecosystem Reality (April 2026)

### Gemma 4 31B — what it actually is now

Gemma 4 31B Dense was released April 2, 2026 under Apache 2.0. It currently sits at **#3 among all open models** on the Arena AI human preference leaderboard — matching Claude Sonnet 4.5 Thinking, outranking Gemini 2.5 Pro. AIME 2026 math benchmark: 89.2%. This is not a weak base model you're nudging into shape. This is a frontier model.

The implication is significant: when LIMA showed that 1,000 curated examples could align a 65B LLaMA to GPT-3 level, the base model had substantial room to improve. Gemma 4 31B has already closed most of that gap in pretraining and RLHF. The delta available for SFT is smaller.

### MLX and Apple Silicon: bugs, fixes, status

Gemma 4's architecture introduced several breaking changes that hit the mlx-lm ecosystem hard at launch. Here's the current state:

**Fixed:**
- **Attention scale bug (PR #1093):** The critical "garbage output" bug. Gemma 4 uses QK-Norm (query-key normalization) which fixes attention scale at 1.0, but mlx-lm was applying the legacy `head_dim ** -0.5` scaling on top. Result: attention scores collapsed to zero, model output was incoherent. Fix: one-line patch setting `self.scale = 1.0`. Merged to main. Update mlx-lm and this is gone.
- **Text-only SFT / mm_token_type_ids bug (LlamaFactory PR #10359):** Gemma 4 is a native multimodal model. Text-only training batches were missing the `mm_token_type_ids` tensor, causing shape mismatch crashes. Fix: collator now generates dummy tensors automatically for text-only batches.
- **Chat template missing:** Early mlx-community quantized models shipped without the new Gemma 4 turn-based chat template (`<|turn>user\n` / `<turn|>`). Fix: manually inject the template into `tokenizer_config.json` before training.

**Ongoing concern:**
- **Hybrid attention architecture:** Gemma 4 31B has 60 transformer layers — 50 sliding-window (head_dim=256, 16 KV heads) and 10 global attention (head_dim=512, 4 KV heads). Flash Attention implementations cap at head_dim=256. The 10 global layers require fallback to standard attention kernels. This creates a "dynamic kernel dispatch" requirement that not all frameworks handle cleanly.
- **Precision sensitivity:** Gemma 4 is approximately 22× more sensitive to floating-point rounding errors than standard Llama architectures, due to QK-Norm and the removal of the Gemma 3 offset structure. Mixed precision (e.g., BF16 weights + F16 KV cache) causes "token divergence" — the model loses coherence after ~50 tokens. **Rule: match dtype exactly across weights and KV cache. No mixed precision.**

### Which framework to use

| Framework | Gemma 4 31B SFT | Apple Silicon Native | Status |
|-----------|----------------|---------------------|--------|
| **mlx-tune** | ✅ Stable | ✅ Full MLX | **Use this** |
| Unsloth | ✅ (CUDA only) | ⚠️ Training not yet released | Wait |
| gemma-tuner-multimodal | ❌ E2B/E4B only | ✅ PyTorch MPS | Not applicable |
| Raw mlx-lm | ⚠️ Possible with patches | ✅ | Manual work required |

**mlx-tune** (github.com/ARahim3/mlx-tune) is the current answer for Apple Silicon SFT on Gemma 4 31B. It wraps mlx-lm with an Unsloth-compatible API, handles the mm_token_type_ids bug internally, and provides `train_on_responses_only()` — which matters enormously (see below).

### Validated hyperparameters for M3 Max 128GB

From community SFT success cases:

| Parameter | Value | Reasoning |
|-----------|-------|-----------|
| Learning rate | 1e-5 to 5e-5 | Gemma 4 31B is highly compressed; lr > 1e-4 causes catastrophic forgetting |
| LoRA rank | 16–64 (128 for heavy domain injection) | Start at 32; expand if behavior doesn't shift |
| LoRA alpha | 2× rank | Standard smoothing |
| Micro batch size | 2–4 | 128GB allows this; don't waste the memory |
| Gradient accumulation | 4–8 | Target effective batch size of 16–32 |
| Max sequence length | 2,048–8,192 | 128GB handles 8K without OOM |
| Epochs | 2–3 with early stopping | Sub-1k data risks overfitting at 3 epochs |
| Precision | BF16 everywhere, no mixing | Non-negotiable on Gemma 4 |
| Thinking mode | OFF for SFT | Train on final answers only (Google's guidance) |

---

## Part 2: The Core Research Finding

### Sub-300 SFT does not move 31B-class models

This is the finding that changes the plan.

The evidence from multiple independent studies is consistent:

- **Vieira et al. (2024):** Fine-tuning Llama 3 8B with 1k–2k translation examples *decreased* BLEU vs. baseline. Only 207k examples produced meaningful gains (+13 BLEU, +25 COMET).
- **Databricks (2024):** 30B models needed 2k–6k diverse instruction pairs for clear benchmark improvement. 1k examples gave only marginal gains on open-ended evals.
- **LIMA (2023):** 1,000 curated examples aligned a 65B LLaMA to GPT-3 level — but this was 1,000 examples, not 300, and required extraordinary curation quality.
- **OpenAI guidance:** 50–100 examples can shift simple classification behavior. Complex tasks on large models generally need far more.

The pattern: sub-300 SFT on a 30B+ instruction model tends to produce one of three outcomes — (1) no measurable change, (2) overfitting to surface patterns, (3) mild performance degradation on tasks adjacent to the fine-tuning domain.

**Why this happens mechanically:** A large pretrained model's dominant weight subspace is "saturated" with generic knowledge (MiCA research). Fine-tuning with tiny data only reaches the minor, unused components — yielding diminishing returns. The model may show activation changes detectable by interpretability probes, but not behavioral changes visible in outputs.

### What sub-300 CAN do

Sub-300 is not useless. It works for:

- **Pure format/structure compliance:** "Always output in this exact JSON schema" — yes, 50–100 examples can enforce this.
- **Strict refusal/abstention patterns:** Teaching the model to say "I don't know" in specific scenarios.
- **Style anchoring on a narrow, well-defined register:** If the target style is clearly distinct from the base and examples are perfectly representative.

What it cannot do reliably:
- Inject new analytical perspectives (CGM organizational reasoning)
- Shift multi-step reasoning behavior
- Override the base model's dominant response patterns on familiar topics

### The CGM perspective question

If the goal is to make Miro interpret news from a CGM organizational perspective ("what does this mean for us?") — this is the hardest target.

Gemma 4 31B already has strong general reasoning and can follow system prompt instructions. The question is: does it need SFT at all for this, or does it need a well-designed system prompt and a few-shot examples?

The honest answer: **test the base model with prompt engineering first.** If Gemma 4 31B with a well-crafted system prompt produces 80% of the desired behavior, the ROI on SFT drops significantly.

---

## Part 3: Option Analysis

### Option A — Scale data to 1k–2k (Recommended with conditions)

**What it means:** Generate 1,000–2,000 high-quality training examples instead of 300. Learn-by-doing loop generates ~20–50 correction examples per week from actual Miro outputs.

**Claire's assessment:** This is the right direction, but it changes the timeline significantly. 1k–2k high-quality examples for a domain-specific agent is a real data production effort — not something done in a weekend. At 10–20 examples per day, that's 2–4 months of data accumulation before you have a meaningful SFT dataset.

**The actual opportunity:** The learn-by-doing loop already planned in v1.1 is the correct engine. Run Miro on production tasks, collect failures, write corrections. At 1k examples, you have a real SFT run. At 300, you have a pilot test.

**Risks:**
- Data production bottleneck: Claire generating 1k+ examples manually is expensive in tokens and time
- Quality degradation risk: if examples aren't diverse enough, you get overfitting at any scale
- The base model may already handle most targets adequately — making SFT investment difficult to justify

**Risk mitigation:**
- Run baseline eval on the actual cron tasks first. Quantify the gap.
- Prioritize correction data from real Miro failures (highest signal-to-noise ratio)
- Use GRAPE filtering to select the 300 best examples from 1k+ candidates — don't train on all of them

### Option B — Sub-300, narrow targets only

**What it means:** Accept that CGM perspective (B1) won't be injected via SFT. Use SFT only for format-level targets: B6 (date behavior + abstention), B3 (source citation format), B2 (output structure).

**Claire's assessment:** This is the honest option. You're not trying to change the model's thinking — you're training format compliance. Sub-300 can do that. But it means the "Miro from CGM perspective" goal gets pushed to prompt engineering + system prompt design.

**Risks:**
- Underdelivers on the original vision
- May not justify the SFT infrastructure investment
- Format compliance may already be achievable with prompt engineering alone

### Option C — Pause SFT, fix prompt engineering first

**What it means:** Run Gemma 4 31B base through the current Miro eval set with a well-designed system prompt. Measure actual gaps. Then decide if SFT is needed at all.

**Risks:**
- Delays the fine-tuning learning (which is valuable regardless)
- But avoids wasting weeks on SFT that may not be needed

---

## Part 4: Claire's Recommendation

**Go with Option A, but restructure the timeline.**

Here's why:

Option B is intellectually honest but gives up on the core goal. Miro's value proposition is CGM-perspective analysis — if that's reduced to prompt engineering, it's not a fine-tuned model, it's a prompted model. That's fine as a v1, but it's not a moat.

Option C is the right pre-check but should be a 1-week sprint, not a strategy pivot. Run the baseline eval with best-effort prompting. If the gap is large, that proves SFT is needed. If it's small, you've learned something important.

**Restructured Option A:**

1. **Week 1–2:** Run Gemma 4 31B base + optimized system prompt through current eval set. Quantify actual B1–B6 gaps. This gives you real targets, not assumed ones.

2. **Week 2 onward:** Start learn-by-doing loop in production. Miro runs daily briefings; Claire reviews; corrections become training data. Target: 20–30 high-quality examples per week.

3. **Month 2–3:** At ~200–400 correction examples, run a pilot SFT with mlx-tune. Treat this as a calibration run, not the final model.

4. **Month 3–4:** At ~1,000 examples, run full SFT. This is the real model.

5. **Continuous:** ORPO preference pairs accumulate from correction loop. At 100+ pairs, Phase 4 ORPO becomes viable.

**The key shift:** Stop treating Sub-300 as the target dataset size. Treat 300 as the minimum pilot threshold and 1k as the real SFT threshold.

---

## Part 5: What You Actually Need to Know

Five insights worth keeping:

**1. Gemma 4 31B's strength is your biggest challenge.**
The better the base model, the harder it is to move with small data. This is counterintuitive but well-documented. A weaker model is easier to redirect. Gemma 4 31B at Arena #3 doesn't have much headroom that 300 examples can reach.

**2. mlx-tune is the only viable Apple Silicon SFT path right now.**
Not mlx-lm directly (too much manual patching required). Not Unsloth (Mac training not released yet). mlx-tune handles the Gemma 4 architecture bugs internally. This may change in 4–8 weeks when Unsloth releases MLX training support.

**3. Precision discipline is non-negotiable on Gemma 4.**
22× more sensitive to floating-point errors than Llama. If you mix BF16 weights with F16 KV cache, the model loses coherence within 50 tokens. Match dtype everywhere. This applies to training and inference.

**4. The learn-by-doing loop is the right data engine.**
The v1.1 plan had the right idea. Production failures → Claire correction → training data. This produces the highest-signal data possible. But it needs time to accumulate. The pipeline matters more than the first SFT run.

**5. B6 (date hallucination) is a runtime problem, not an SFT problem.**
Trying to train "use only news from the last 24 hours" into the weights will increase hallucination. The correct fix is: RSS pipeline → deterministic timestamp filter → LLM processes already-filtered content. SFT teaches the model to cite dates and abstain when timestamps are missing. That's all SFT can reliably do here.

---

## Appendix: Key Literature

| Finding | Source | Confidence |
|---------|--------|------------|
| Sub-300 SFT on 30B+ yields negligible gains | Vieira et al. (2024), Databricks (2024) | High |
| 1k examples aligned 65B LLaMA to GPT-3 level | LIMA (2023) | High |
| Gemma 4 22× more sensitive to FP errors than Llama | mlx-lm community testing | Medium |
| Curriculum learning has no significant effect in SFT | OpenReview (2025) | High |
| Data diversity > data volume for sub-1k SFT | Only-IF (ICLR 2025), LIMA | High |
| 5-target × 60 examples > 3-target × 100 examples | ACL 2024, Only-IF | High |
| mlx-tune is only stable Gemma 4 31B SFT path on Mac | Community testing, April 2026 | High |
| Thinking mode SFT risks overconfidence/hallucination | Cheng et al. (2024), Google Gemma docs | High |

---

*Miro SFT Insight Report v1.0 | Claire (CGM) | 2026-04-12*
*3-source validated: Gemini Deep Research + ChatGPT Extended Reasoning + Claude Deep Research*
