---
date: 2026-05-16
tag: systems
title: "The KV cache, from first principles"
read: 14 min
deck: "Start with tokenization, walk through attention, end at the number that decides how much LLM inference actually costs. With a small calculator."
---

The number that decides how much your LLM inference bill is doesn't appear on the model card. It isn't the parameter count. It isn't the context length you advertise. It's the **KV cache** — a per-request scratchpad that sits in GPU memory and grows with every token the model generates.

If you serve models, the KV cache is the dominant resource you're managing, whether you know it or not. Every recent inference innovation — grouped-query attention, paged attention, prefix caching, quantized cache — exists to make this one number smaller.

This post walks from tokenization to attention to the cache, in that order. By the end you'll understand why it exists, what determines its size, and why two 7B-parameter models can have wildly different serving economics depending on how their attention is shaped.

## what an LLM actually does

A language model does exactly one thing: **given a sequence of tokens, predict the probability distribution over the next token.** That's the entire primitive. Chat, code generation, agentic tool use — all of it is this loop, called repeatedly.

```
input:  ["The", " quick", " brown"]
output: { " fox": 0.62, " dog": 0.11, " cat": 0.04, ... }   // over a ~50k vocabulary
sample one token, append, repeat.
```

To generate `" fox"`, the model has to take three tokens and produce a calibrated distribution over fifty thousand. The thing that does that is the transformer — a stack of attention layers. To understand the KV cache, we need to understand attention. To understand attention, we need to know what a "token" even is.

## tokenization

Models don't process text. They process **integer IDs**. Tokenization is the deterministic mapping from a UTF-8 string to a list of integers.

Why not characters or words?

- **Characters** give you a tiny vocabulary (~256 bytes) but enormous sequences. The model has to relearn "cat" relates to "kitten" from scratch.
- **Words** give you semantic units but a vocabulary in the millions, and you can't handle any word the model didn't see in training. "OOV" — out of vocabulary — becomes a permanent problem.
- **Subwords** (the standard) split the difference. A fixed vocabulary of ~30k–100k pieces, where common words are one token and rare words split into pieces.

Subword tokenization typically uses Byte-Pair Encoding (BPE). The training process:

1. Start with all single bytes as the vocabulary.
2. Count adjacent pairs in the corpus. Most frequent pair wins.
3. Merge that pair into a new token. Add to vocabulary.
4. Repeat until the vocab reaches the target size.

At inference time, you greedily apply the learned merges. Same input always produces the same tokens.

```
"tokenization is wild"
  →  ["token", "ization", " is", " wild"]
  →  [9712, 2065, 318, 4295]
```

Notice the leading space on `" is"` — most modern tokenizers fold whitespace into the following token so detokenization is a trivial concatenation.

This matters for serving: **the units that matter operationally are tokens, not characters.** Pricing, context windows, KV cache size — all in token units. Rough English heuristic: 1 token ≈ 4 characters ≈ 0.75 words. Code, JSON, and non-English text spend more tokens per character.

## embeddings: from IDs to vectors

Integer IDs are useless on their own — token #5712 isn't five times bigger than token #1142. So each ID is converted into a dense vector through a learned lookup table.

```
token_id    →    embedding vector
   5712     →    [0.12, -0.84, 0.31, ...]   // typically 768 to 8192 floats
```

The embedding table is a matrix of shape `[vocab_size, hidden_dim]`. Looking up a token is just a row read. These vectors encode "what the model knows" about each token in a compressed form, learned during training.

Attention is permutation-invariant by default — it doesn't care about token order — so position information is injected either by adding learned position vectors, or via rotational schemes like RoPE that bake position into the attention math. The detail doesn't matter for our purposes. Just know: the model has a way to tell that token #3 came before token #4.

## attention: the one operation that matters here

Attention is the operation that lets each token "look at" every other token in the sequence and pull in information from them. It's the only place in a transformer where tokens talk to each other; everything else is per-token. And it's the place where the KV cache lives.

### the classroom

The cleanest way to picture this is a classroom. Each token in a sentence is a student sitting in a row.

```
the   cat   sat   on   the   mat
```

The principal claps: *"each of you, figure out what you mean in this exact sentence."*

Student "sat" can't do that alone — by itself it could mean a hundred things. It needs to look at the other students and pull in context. So does every other student.

To do this, every student walks in carrying **three index cards**:

- **Q card** — the question this student is asking. *"Who's doing me? Where's it happening?"*
- **K card** — the label this student advertises to others. *"I'm a subject! I'm a verb! I'm a determiner!"*
- **V card** — the actual info this student shares if matched. *"Animal, four legs, mammal, often a pet…"*

The dance, in lock-step across the whole row:

1. Hold up your **Q card** — "here's what I'm asking."
2. Look at every other student's **K card**.
3. Score how well each K matches your Q (high = relevant, low = irrelevant).
4. Pull in each student's **V card** content, weighted by the scores from step 3.

For "sat" specifically:

- "cat"'s K says *"subject!"* → high match → "sat" pulls in lots of "cat"'s V
- "on"'s K says *"position word!"* → high match → pulls in lots of "on"'s V
- "the"'s K says *"just a determiner"* → low match → pulls in almost nothing

After the dance, "sat" no longer means just "the verb sat" — it carries a blended infusion of context. Every other student does the exact same dance at the exact same time. **Q asks. K announces. V delivers.**

### Q, K, V are vectors, not cards

The "cards" the model actually uses aren't text — they're short lists of numbers (vectors). For each token, the model produces three vectors via three learned linear projections. If your hidden dimension is 768, those projections are 768×768 weight matrices: `W_q`, `W_k`, `W_v`. Same token in → three different vectors out.

### the operation in matrix form

Stack all the Qs, Ks, Vs into matrices. Then:

```
Attention(Q, K, V) = softmax( Q · K^T / √d_k ) · V
```

Mapped back to the classroom:

1. **`Q · K^T`** — every Q dot-products with every K. Result: an N×N grid of "how well does this Q match that K?" scores. *This is step 3 of the dance, vectorized.*
2. **`/ √d_k`** — scale by the square root of the key dimension. Keeps gradients stable. Bookkeeping.
3. **softmax** across each row — turns raw scores into probability weights that sum to 1. Bookkeeping.
4. **`· V`** — weighted sum of V vectors using those weights. *This is step 4 of the dance.*

The formula runs the entire classroom in matrix form, in one shot — every student asking, every student answering. The 2017 paper that introduced this is [Attention Is All You Need](https://arxiv.org/abs/1706.03762) — eight authors, eleven pages, the foundation of every modern model.

### multi-head — many classrooms in parallel

One run of attention is one classroom focusing on one type of relationship (maybe grammar, maybe topic, maybe long-range reference). Models run many classrooms in parallel — Llama 3 8B has 32 of them per layer. Each "head" learns to attend to a different pattern. The outputs concatenate and combine before going to the next layer.

The number that matters for the KV cache is the number of **K and V heads**. In the original transformer that equals the number of Q heads. In modern Grouped-Query Attention (GQA) models — Llama 2 70B, Llama 3, Mistral — there are fewer K/V heads than Q heads, shared across groups. We'll come back to this.

### causal masking

When generating, the student at position *t* isn't allowed to look at students at positions *t+1, t+2*, … — they haven't been written yet. We set their relevance scores to `-∞` before softmax, which makes their weights zero. The math is otherwise unchanged.

```
                k1     k2     k3     k4
         q1 [   ✓     -∞     -∞     -∞  ]
         q2 [   ✓      ✓     -∞     -∞  ]
         q3 [   ✓      ✓      ✓     -∞  ]
         q4 [   ✓      ✓      ✓      ✓  ]
```

This is the property that makes the KV cache possible. Each student's K and V depend only on students to their left — never on anything to their right. Once a student walks in and sets up their K and V cards, those cards never change.

## the transformer block, briefly

A transformer is a stack of identical blocks. One block:

1. LayerNorm the input.
2. Multi-head self-attention. Add the result back to the input (residual).
3. LayerNorm again.
4. Feed-forward network. Add back (residual).

A real model stacks 12 to 96 of these. Each block transforms the per-token vectors into something more useful for the prediction task. Information mixes across positions only inside the attention sublayer. The feed-forward layer is purely per-token. **All of the cross-token work happens in attention.**

This is the second property that makes the KV cache possible: attention is the only place that needs cross-token state.

## how generation works

End-to-end, generating one new token looks like:

1. Tokenize the input → list of token IDs.
2. Look up each ID in the embedding table.
3. Add position information.
4. Pass through N transformer blocks. The shape stays `[seq_len, hidden_dim]` throughout.
5. Final LayerNorm.
6. Multiply by an "unembedding" matrix → `[seq_len, vocab_size]`. The last row is the logits for the next token.
7. Softmax → probability distribution.
8. Sample (or argmax) → next token. Append to the sequence. Go back to step 4.

The loop is the part to focus on. Every iteration, we go back to step 4 with a sequence one token longer. *Most of the work in step 4 is identical to what we did last time.* That's the opening for the optimization.

## the KV cache

### the naive cost

Suppose you've generated N tokens and want to generate token N+1. The forward pass needs K and V vectors for every position from 1 to N+1, at every layer.

Without caching, you'd recompute K and V for tokens 1 through N every time. That's O(N) projection work to produce one new token, just to redo computation you did last step. And the attention itself — Q · K^T over the full sequence — is O(N²) per step. Generating a sequence of length L becomes O(L³).

### the fix is trivial

The K and V vectors for past tokens **never change**. Once we've computed K_3 at layer 7, it's frozen forever. The causal mask guarantees that K_3 doesn't depend on anything to its right, and embeddings/projections are deterministic. The K and V for token *i* depend only on tokens 1..i. So just keep them.

At each generation step:

1. Compute Q, K, V only for the new token.
2. Append the new K and V to the cache (one slot per layer).
3. Compute attention with the fresh single-token Q against the full cached K, V.

Per-step projection work drops from O(N) to O(1). Attention drops from O(N²) recomputation to O(N) per step. Generating a sequence of length L drops from O(L³) work to O(L²) — and the L² is now a single attention pass per step, not a full re-run.

This is the same intuition as caching expensive query results in a database. The cache is **trivially correct** because the cached values are immutable — no invalidation logic, no consistency dance, no eventual-consistency surprises. The only question is memory.

<svg viewBox="0 0 720 380" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="KV cache growth across three generation steps" style="display: block; width: 100%; max-width: 720px; height: auto; margin: 28px auto;">
  <style>
    .step-title { fill: var(--ink); font-family: var(--mono); font-size: 12px; text-anchor: middle; font-weight: 500; }
    .step-sub { fill: var(--ink-faint); font-family: var(--mono); font-size: 10px; text-anchor: middle; }
    .row-label { fill: var(--ink-soft); font-family: var(--mono); font-size: 11px; }
    .slot-text { fill: var(--ink); font-family: var(--mono); font-size: 10px; text-anchor: middle; }
    .slot-text-new { fill: white; font-family: var(--mono); font-size: 10px; text-anchor: middle; font-weight: 600; }
    .cached { fill: var(--bg-alt); stroke: var(--rule); stroke-width: 1; }
    .new-slot { fill: var(--accent); stroke: var(--accent); stroke-width: 1; }
    .legend-text { fill: var(--ink-soft); font-family: var(--mono); font-size: 10.5px; }
    .caption { fill: var(--ink-faint); font-family: var(--mono); font-size: 10px; text-anchor: middle; }
    .col-divider { stroke: var(--rule); stroke-width: 1; stroke-dasharray: 2 4; }
  </style>
  <line class="col-divider" x1="230" y1="20" x2="230" y2="190"/>
  <line class="col-divider" x1="450" y1="20" x2="450" y2="190"/>
  <text class="step-title" x="100" y="30">step 1</text>
  <text class="step-sub" x="100" y="46">generated: "The"</text>
  <text class="row-label" x="20" y="100">K</text>
  <rect class="new-slot" x="50" y="80" width="60" height="34" rx="4"/>
  <text class="slot-text-new" x="80" y="101">k_the</text>
  <text class="row-label" x="20" y="150">V</text>
  <rect class="new-slot" x="50" y="130" width="60" height="34" rx="4"/>
  <text class="slot-text-new" x="80" y="151">v_the</text>
  <text class="step-title" x="335" y="30">step 2</text>
  <text class="step-sub" x="335" y="46">generated: "The cat"</text>
  <text class="row-label" x="240" y="100">K</text>
  <rect class="cached" x="270" y="80" width="60" height="34" rx="4"/>
  <text class="slot-text" x="300" y="101">k_the</text>
  <rect class="new-slot" x="334" y="80" width="60" height="34" rx="4"/>
  <text class="slot-text-new" x="364" y="101">k_cat</text>
  <text class="row-label" x="240" y="150">V</text>
  <rect class="cached" x="270" y="130" width="60" height="34" rx="4"/>
  <text class="slot-text" x="300" y="151">v_the</text>
  <rect class="new-slot" x="334" y="130" width="60" height="34" rx="4"/>
  <text class="slot-text-new" x="364" y="151">v_cat</text>
  <text class="step-title" x="585" y="30">step 3</text>
  <text class="step-sub" x="585" y="46">generated: "The cat sat"</text>
  <text class="row-label" x="460" y="100">K</text>
  <rect class="cached" x="490" y="80" width="60" height="34" rx="4"/>
  <text class="slot-text" x="520" y="101">k_the</text>
  <rect class="cached" x="554" y="80" width="60" height="34" rx="4"/>
  <text class="slot-text" x="584" y="101">k_cat</text>
  <rect class="new-slot" x="618" y="80" width="60" height="34" rx="4"/>
  <text class="slot-text-new" x="648" y="101">k_sat</text>
  <text class="row-label" x="460" y="150">V</text>
  <rect class="cached" x="490" y="130" width="60" height="34" rx="4"/>
  <text class="slot-text" x="520" y="151">v_the</text>
  <rect class="cached" x="554" y="130" width="60" height="34" rx="4"/>
  <text class="slot-text" x="584" y="151">v_cat</text>
  <rect class="new-slot" x="618" y="130" width="60" height="34" rx="4"/>
  <text class="slot-text-new" x="648" y="151">v_sat</text>
  <rect class="cached" x="160" y="240" width="24" height="18" rx="3"/>
  <text class="legend-text" x="195" y="253">cached from a previous step — no recomputation</text>
  <rect class="new-slot" x="160" y="270" width="24" height="18" rx="3"/>
  <text class="legend-text" x="195" y="283">computed this step — the new token's K and V</text>
  <text class="caption" x="360" y="335">one layer of the KV cache, growing by one column per generated token.</text>
  <text class="caption" x="360" y="352">past entries never change — that's why caching them is trivially correct.</text>
</svg>

### the memory math

The KV cache size, per request, is:

```
kv_bytes = 2 × layers × seq_len × kv_heads × head_dim × bytes_per_element
            ↑
            K and V
```

For a typical 7B-parameter model in fp16, that's around 0.5 MB per token. A 4,000-token context: ~2 GB of GPU memory **per concurrent request**, just for the cache.

Try the numbers yourself:

<div data-widget="kv-cache-calc"></div>

A few things worth doing in the calculator:

- Switch between **Llama 2 7B** (32 KV heads) and **Llama 3 8B** (8 KV heads, GQA). The total cache drops 4×. Same parameter count, very different serving cost. That's the whole point of GQA.
- Bump **seq length** from 4k to 32k. The cache grows linearly. This is why "long context" models are expensive even when the parameter count is unchanged.
- Bump **batch** to 32 (serving 32 concurrent users). Now you're paying 32× the per-request cache cost. This is where the cache starts to dominate GPU memory, not the weights.
- Switch **dtype** to int8. Cache halves. int4 quarters it. Modest accuracy cost, large memory win.

This is the whole reason serving frameworks exist: managing this cache well decides throughput.

## why this drives every modern inference innovation

Once you see that the cache scales as `layers × seq_len × kv_heads × head_dim × batch × bytes`, every recent technique becomes legible as a different multiplier you're trying to reduce:

- **Grouped-Query Attention (GQA) / Multi-Query Attention (MQA)** — reduce `kv_heads`. Share K and V across multiple Q heads. Used by Llama 2 70B, Llama 3, Mistral, most modern open models. Typically 4–8× smaller cache for negligible quality cost.
- **Sliding-window / local attention** — bound `seq_len`. Only keep the last w tokens' K and V. Fixed memory, but you lose long-range context.
- **PagedAttention (vLLM)** — manage the cache like virtual memory in an OS, in fixed-size pages. Lets many concurrent requests pack efficiently and share prefixes. Doesn't change the math; changes who pays it and when.
- **Quantized KV cache** — reduce `bytes_per_element`. Store K, V in int8 or int4 instead of fp16. Cache halves or quarters at modest accuracy cost. Increasingly standard.
- **Prefix caching** — if many requests share a long system prompt, compute its K, V once and reuse across requests. Same K/V tensors, lower `batch` multiplier effectively. Trivially correct (the prefix tokens are the same in every request), big latency win.

If you're running an inference service, the KV cache **is** your dominant resource. Throughput is determined by how many concurrent caches fit in GPU memory. Latency is determined by how fast you can read them. Every serving framework you've heard of — vLLM, TGI, TensorRT-LLM, Triton — is largely a story about managing this cache well.

## one breath

- Models predict next-token distributions over a fixed vocabulary of subword tokens.
- Tokens become dense vectors via an embedding lookup.
- Attention is differentiable fuzzy lookup: each token issues a Query, every token offers a Key and Value, you get a weighted blend back.
- Causal masking + per-token-only feed-forward = K and V for past tokens never change.
- The KV cache stores them so generation drops from O(L³) to O(L²) work.
- Cache size = `2 × layers × seq_len × kv_heads × head_dim × bytes × batch`. That's the number that decides how much your inference bill is.

If you're going deeper, in this order: Karpathy's [Let's build GPT](https://www.youtube.com/watch?v=kCc8FmEb1nY) (build a transformer in 2 hours, in a notebook); then the [PagedAttention paper](https://arxiv.org/abs/2309.06180) for what production serving actually looks like; then the Llama 3 paper for a worked example of every choice in this post made by people who shipped at scale.

— v
