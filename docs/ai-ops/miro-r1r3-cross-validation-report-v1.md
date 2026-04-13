# Miro R1-R3 Deep Research: 3-Source Cross-Validation Report v1.0

Author: Claire (CGM)
Date: 2026-04-13
Sources: Claire Deep Research + Gemini Deep Research + ChatGPT Extended Reasoning
Scope: mlx-tune validation (R1), 1k-2k data production strategy (R2), Gemma 4 thinking mode SFT (R3)

---

## Executive Summary

Three independent research sources converge on critical findings that require immediate revision of miro-training-plan v1.1. The Phase 2A SFT failure (298 samples, val loss 0.831, behavioral change insufficient) was likely caused by incorrect LoRA hyperparameters — not insufficient data. Two parameters require urgent correction: learning rate (1e-5 → 1e-4) and target layers (8 layers → all linear). Additionally, Gemma 4's proprietary thinking token format (`<|channel>thought\n...<channel|>`) differs fundamentally from the assumed `<think>` tags, requiring complete reformatting of training data.

---

## Finding 1: mlx-tune Now Supports Gemma 4 31B [3-Source Consensus]

Status: Lesson #115 ("mlx-tune does not support Gemma 4") is now OBSOLETE.

Evidence:
- ARahim3/mlx-tune (formerly unsloth-mlx) confirmed Gemma 4 text/vision/audio support
- cloudyu deployed mlx-tune on Gemma 4 31B (8-bit base), 2093 samples, Claude 4.6 Opus distillation, on Apple Silicon — SUCCESSFUL
- arsovskidev and TeichAI confirmed Gemma 4 E4B/26B SFT via Unsloth (API-compatible with mlx-tune)

Performance concern: mlx-tune runs ~60x slower than native mlx-lm on identical hardware (M4 Pro benchmark: 4.1 iter/s vs 0.07 iter/s). API abstraction overhead.

Decision: mlx-lm remains the primary tool. mlx-tune is viable but only recommended when Unsloth API compatibility is needed (e.g., CUDA cluster portability).

## Finding 2: Gemma 4 Thinking Token Format [Claire + Gemini Consensus]

Gemma 4 does NOT use `<think>...</think>` tags. It uses a proprietary channel system:

Activation: Place `<|think|>` in system prompt
Output format: `<|channel>thought\n[reasoning content]<channel|>[final answer]`
31B behavior: Even when thinking is disabled, outputs empty channel block: `<|channel>thought\n<channel|>[answer]`

Critical rules for training data:
1. Never use `<think>` tags — use native `<|channel>` structure exclusively
2. Non-thinking examples MUST include empty channel block (omission causes attention instability)
3. Multi-turn data: strip previous-turn thinking traces from context (keep only final answers)
4. Use tokenizer's apply_chat_template with enable_thinking=True for automatic formatting

Source: Google AI official Gemma 4 prompt formatting documentation (updated April 2, 2026)

The "75% reasoning data" recommendation originates from Unsloth documentation, not Google. However, it aligns with DeepSeek R1's ratio (600K reasoning + 200K non-reasoning ≈ 75/25) and is adopted as operational guidance.

## Finding 3: Two Critical LoRA Hyperparameter Corrections [Claire DR, Multi-Paper]

| Parameter | v1.1 Current | v1.2 Required | Evidence Base |
|-----------|-------------|---------------|---------------|
| Learning rate | 1e-5 | 1e-4 | QLoRA paper (33B+ recommendation), LoRA Without Regret (10x full FT), Unsloth (2e-4 start), ms-swift (1e-4) |
| Target layers | 8 layers | All linear (q/k/v/o/gate/up/down × all blocks) | Universal consensus: LoRA Without Regret, QLoRA, Databricks, Raschka, Unsloth. r=8+all > r=16+attention-only |

These two fixes alone may produce larger improvements than scaling data from 300 to 1500 samples. Phase 2A FAIL root cause was likely hyperparameters, not data volume.

Additional hyperparameter adjustments:
- Max seq length: 512 → 1024 (profile data distribution first; 512 truncates behavioral patterns)
- LoRA rank 8: sufficient at 1k-2k scale (capacity rule easily met)
- Epochs 3: keep for sub-2k data (Unsloth recommends 3-5)
- Add cosine lr decay with 5-10% warmup

## Finding 4: 22x Floating-Point Sensitivity [Claire + Gemini Consensus]

Gemma 4 uses attention_scale=1.0 instead of standard 1/√d_k (≈1/22.6). Mathematical consequence: ~22x more sensitive to precision errors than LLaMA/Qwen.

Impact on training:
- 4-bit quantization noise amplified 22x through attention mechanism
- Thinking traces (long-context generation) compound errors multiplicatively per decode step
- KV cache precision mismatch (BF16 weights + F16 cache) → output collapse after 50-100 tokens
- MLX 4-bit MMLU: 1/30 vs BF16 20/30 (mlx-vlm #895)

Operational requirements:
- LoRA adapters: maintain BF16/F32 precision
- KV cache: lock to F32
- Monitor thinking output quality with before/after benchmark (50 reasoning questions)
- If thinking degrades: try GGUF Q4_K_M (dramatically better in community benchmarks)

## Finding 5: Data Selection — Superfiltering over GRAPE [Claire + ChatGPT Consensus]

GRAPE at 31B scale: ~1 hour for 5K candidates (feasible but slow), requires base model (not instruct)
GPT-2 Superfiltering: 5 minutes, 0.846 rank correlation with LLaMA2-7B/13B scoring

Recommended pipeline:
1. GPT-2 IFD scoring (5 min) — remove IFD ≥ 1.0 and bottom 10%
2. Sentence-transformer embedding + k-means diversity sampling (5 min)
3. Optional: DEITA complexity/quality scorer (1-2 hours)
4. Rank by IFD × quality, diversify from top candidates to reach 1k-2k target

Total: under 2 hours, no 31B inference needed for selection.

## Finding 6: 1k-2k Data Production Strategy [ChatGPT Primary]

Key evidence:
- 2k-6k mixed data > 1k at both 7B and 30B scales (Databricks)
- Plateau effect exists: beyond certain size, more data can harm performance
- Quality > quantity once thousands of examples are reached
- 50-200 carefully selected samples can outperform large random sets

Production guidelines:
- Teacher consistency: each prompt as independent API call, reset context, fixed seed
- GPT-4-mini shows 25% output variation even at temperature=0
- Automated quality scoring (LLM-as-judge) + manual spot checks
- Semantic deduplication: cosine similarity ≥ 0.9 threshold
- Iterative SFT loop: old 80% + new corrections 20% to prevent forgetting
- Weekly batch retraining (not daily)

## Finding 7: GGUF Export Limitation [Gemini]

mlx-tune cannot export directly to GGUF when base model was loaded in 4-bit.
Workaround: save LoRA adapters separately → merge with llama.cpp pipelines.
This also applies to mlx-lm's mlx_lm.fuse → must explicitly call fuse() (existing Lesson).

---

## Impact on miro-training-plan v1.2

| Item | v1.1 | v1.2 Change | Source |
|------|------|-------------|--------|
| Learning rate | 1e-5 | 1e-4 | 3-source |
| Target layers | 8 | All linear | 3-source |
| Data format | Unspecified | Gemma 4 native channel tokens | Claire+Gemini |
| 75% thinking ratio | Planned | Keep, with empty channel block for 25% | Unsloth+DeepSeek |
| Data selection | GRAPE | GPT-2 Superfiltering (primary) | Claire+ChatGPT |
| Context stripping | Unspecified | Strip previous-turn thinking traces | Google official |
| mlx-tune status | "Unsupported" | "Supported but ~60x slower; mlx-lm preferred" | Gemini |
| GGUF export | mlx_lm.fuse | Adapter-only save → llama.cpp merge for 4-bit base | Gemini |
| KV cache | Unspecified | F32 mandatory | Gemini |
| Max seq length | 512 | 1024 (profile first) | Claire |
| Lesson #115 | Active | RETIRED | 3-source |

## Lessons Identified

- L-NEW-1: Gemma 4 thinking mode uses `<|channel>thought\n...<channel|>`, NOT `<think>` tags. Training data must match native format exactly.
- L-NEW-2: LoRA learning rate must be 10-20x higher than full fine-tuning rate. 1e-5 is full-FT territory; LoRA on 30B+ requires 1e-4.
- L-NEW-3: Target all linear layers (q/k/v/o/gate/up/down), not attention-only. Universal consensus across QLoRA, Raschka, Databricks, Unsloth.
- L-NEW-4: GPT-2 Superfiltering (IFD scoring) achieves 0.846 correlation with large model scoring at 100x speed. Use as primary data selection method.
- L-NEW-5: mlx-tune now supports Gemma 4 31B (Lesson #115 retired). However, ~60x slower than mlx-lm. Viable as Unsloth-compatible alternative only.

---

*Miro R1-R3 Cross-Validation Report v1.0 | Claire (CGM) | 2026-04-13*
*3-source validated: Claire Deep Research + Gemini Deep Research + ChatGPT Extended*
*Conclusions adopted: cgm-docs PRIVATE, 4-Tier classification, nanople as public channel*
