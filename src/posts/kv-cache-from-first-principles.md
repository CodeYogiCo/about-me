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

### Q, K, V

For each token, the model produces three vectors from its embedding via three learned linear projections:

- **Query (Q)** — what am I looking for?
- **Key (K)** — what do I have to offer?
- **Value (V)** — if you matched on me, here's what I'll give you.

If your hidden dimension is 768, the projections are three 768×768 weight matrices: `W_q`, `W_k`, `W_v`.

### the operation

Stack all the Qs, Ks, Vs into matrices. Then:

```
Attention(Q, K, V) = softmax( Q · K^T / √d_k ) · V
```

In four steps:

1. **`Q · K^T`** — every token's query dot-products with every token's key. Result: an N×N matrix of relevance scores.
2. **`/ √d_k`** — divide by the square root of the key dimension. Scaling fix for gradient stability.
3. **softmax** across each row — turns the scores into a probability distribution that sums to 1.
4. **`· V`** — multiply by the value matrix. For each token, this gives a weighted sum of all value vectors, weighted by the attention probabilities.

The way I find this easiest to hold in my head: attention is a **differentiable, fuzzy database lookup**. Q is your query, K is the index, V is the row data. Instead of returning a single matching row, you return a weighted blend of every row, where the weights come from how well each row's K matched your Q. The projections (`W_q`, `W_k`, `W_v`) get tuned by training to make the lookups useful.

### multi-head

One set of (W_q, W_k, W_v) gives one "view" of how tokens relate. Doing attention multiple times in parallel with independent projections gives multiple views. Each "head" learns to attend to something different — one might learn syntactic agreement, another might track entities, another long-range references.

Mechanically: split the hidden dimension into h chunks (e.g. 12 heads × 64 dims = 768), run attention on each chunk in parallel, concatenate the outputs, project back through one more linear layer.

The number that matters for KV cache is the number of **K and V heads**. In the original transformer, that equals the number of Q heads. In modern architectures with Grouped-Query Attention (GQA) — Llama 2 70B, Llama 3, Mistral — there are fewer K/V heads than Q heads, shared across groups. We'll come back to this.

### causal masking

When generating, the token at position *t* must not be allowed to attend to positions *t+1, t+2*, … — they don't exist yet, and during training we'd be cheating if we let it peek.

Implementation: before the softmax, set the upper triangle of the Q·K^T matrix to `-∞`. After softmax those positions get probability zero. The math is otherwise unchanged.

```
                k1     k2     k3     k4
         q1 [   ✓     -∞     -∞     -∞  ]
         q2 [   ✓      ✓     -∞     -∞  ]
         q3 [   ✓      ✓      ✓     -∞  ]
         q4 [   ✓      ✓      ✓      ✓  ]
```

This is the property that makes the KV cache possible. We'll see it in a moment.

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
