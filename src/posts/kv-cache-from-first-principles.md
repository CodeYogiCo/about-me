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

When the model is *generating* a sentence one word at a time, the row of students isn't fixed up front — it's growing. The principal calls "the", then "cat", then "sat"… one student at a time.

When a brand-new student walks in, they're only allowed to look at students who've already taken their seat — the ones to their left. They can't peek at empty chairs to their right, because the students who will sit there haven't been called yet (that's literally the question the model is trying to answer: who comes next?).

In matrix terms, we set the "relevance score" between a student and any not-yet-arrived neighbor to `-∞` before softmax. Those weights become zero. The dance is otherwise the same.

```
                k1     k2     k3     k4
         q1 [   ✓     -∞     -∞     -∞  ]
         q2 [   ✓      ✓     -∞     -∞  ]
         q3 [   ✓      ✓      ✓     -∞  ]
         q4 [   ✓      ✓      ✓      ✓  ]
```

This is the property that makes the KV cache possible. Each student's K and V cards depend only on students to their left — never on anyone to their right. **Once a student walks in and sets up their cards, those cards never change.**

## the transformer block — one round, plus a moment alone

So far we've described **one round** of the classroom dance — every student asking, every other student answering, everyone walking away with enriched context.

A real transformer runs many rounds. Each "transformer block" is one round, plus a brief moment of solo digestion:

1. **The dance** (attention) — students absorb context from each other.
2. **Solo digestion** (a per-student calculation called the *feed-forward network*) — each student goes to a corner and processes what they just heard, on their own, without talking to anyone else.
3. **Carry forward** (the *residual connection*) — they keep their original thoughts *plus* the new context. Nothing is forgotten.

Then we run another round. And another. Llama 3 8B runs **32 rounds** stacked on top of each other.

In round 1, "sat" picks up basic context — *cat is the subject, on is the position*. In round 2, "sat" can have a richer conversation because every other student also got enriched in round 1. By round 5, the context has compounded enough that "sat" knows it's part of a complete idea about a cat on a mat. By round 32, every student has a deeply layered understanding of their role in the sentence.

The key property for the KV cache: **all cross-student conversation happens inside attention**. Solo digestion is per-student — nobody else's K or V is involved there. So when we cache K and V, we're caching exactly the cross-student state the next round needs.

## how generation works

To generate a new word, the model plays a guessing game with the principal.

1. The current row of students sits down. Some are already in the row from earlier generations; the next chair is empty.
2. The principal runs all 32 rounds of the dance.
3. After the last round, each student has a deeply enriched representation. We look at the **last** student in the row — the one closest to the empty chair.
4. That student "speaks" — really, produces a probability distribution over every word in the vocabulary: *"given this sentence so far, what word is most likely to come next?"*
5. The principal picks a word (usually the most likely, sometimes a sampled one for variety) and calls that student to fill the empty chair.
6. The row has grown by one. Repeat from step 1.

This is the generation loop. Every iteration we add one new student and re-run all 32 rounds. And here's the thing — **most of those 32 rounds involve students who haven't changed since the last iteration.**

That's the opening for the optimization.

## the KV cache

### the naive cost — making everyone rewrite their cards every time

Say 100 students are already seated. We call student 101. To run round 7 of the dance, every student in the row needs their K and V cards.

Without caching, student 1 has to **rewrite** their cards from scratch — even though student 1's cards depend only on student 1 and haven't changed since the very first iteration. Same for students 2, 3, … all 100 of them. Each generation step wastes 100 students × 32 rounds of work re-doing what they already did.

And the dance itself — every student asking every other student — gets quadratically more expensive as the row grows.

Generating a long sentence under this naive approach is *cubically* expensive in sentence length. Painfully so.

### the fix is trivial — give every student a folder

Each student carries a folder. The first time they fill out their K and V cards (in each of the 32 rounds), the cards go in their folder. From then on, when the principal asks "K and V please" — they just hand over the folder.

The folder is the **KV cache**. Each new generation step only requires the *brand-new* student to write fresh cards. Everyone else hands over what they already had.

The math drops from cubic to quadratic. Generation suddenly becomes fast.

This works for the same reason database query caching works — the cached values are *immutable* once written. No invalidation logic, no consistency dance. The only question is: how much space do all these folders take?

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

### the memory math — how big are the folders?

Each student's folder per round depends on:

- **How many parallel classrooms** (heads) the dance is split across
- **How detailed each card is** (the head dimension — how many numbers in each Q/K/V vector)
- **What format the numbers are stored in** (fp16 = 2 bytes each, int8 = 1 byte each, …)

Multiply by:

- **How many rounds** (layers) — typically 32
- **How many students in the row** (sequence length) — could be thousands
- **How many simultaneous conversations** (batch size — concurrent users you're serving)

```
kv_bytes = 2 × layers × seq_len × kv_heads × head_dim × bytes_per_element × batch
            ↑
            (K and V are two separate cards)
```

For a 7B-parameter model in fp16, that works out to about **0.5 MB per student, per conversation**. A conversation with 4,000 students: ~2 GB of GPU memory **per concurrent conversation**, just for the folders.

Try the numbers yourself:

<div data-widget="kv-cache-calc"></div>

A few things worth doing in the calculator:

- Switch between **Llama 2 7B** (32 KV heads) and **Llama 3 8B** (8 KV heads, GQA — a "folder-shrinking" trick we'll see in a sec). Total folder size drops 4×. Same parameter count, completely different serving cost.
- Bump **seq length** from 4k to 32k. Folders grow linearly with student count. This is why "long context" models are expensive even when the model itself is unchanged.
- Bump **batch** to 32 (serving 32 conversations at once). Now you pay 32× the per-conversation cost. This is when folders start to dominate GPU memory, not the model weights.
- Switch **dtype** to int8. Folder size halves. int4 quarters it. Tiny accuracy hit, big memory win.

This is the whole reason serving frameworks exist: managing the folders well decides throughput.

## why this drives every modern inference innovation

Once you see the formula, every recent technique becomes legible as a different way to shrink one of the multipliers:

- **Grouped-Query Attention (GQA)** — instead of each student-asker having their own dedicated K and V advertisers, *groups* of askers share the same K/V advertisers. Fewer folders to store. Used by Llama 2 70B, Llama 3, Mistral, most modern open models. Typically 4–8× smaller folders for negligible quality cost.
- **Sliding-window attention** — only keep the last *w* students' folders in the cabinet. Older students "leave the room." Bounded memory, lose long-range memory.
- **PagedAttention (vLLM)** — manage the folder cabinet like virtual memory in an operating system — fixed-size shelves filled, freed, and shared across conversations. Doesn't change the math; just packs the cabinet better.
- **Quantized KV cache** — write the cards in shorthand. Store K and V as int8 or int4 instead of fp16. Cuts folder size by half or three-quarters at modest quality cost. Increasingly standard.
- **Prefix caching** — if many conversations start with the same intro ("You are a helpful assistant…"), compute those folders once and share them across conversations. Trivially correct — the intro is identical every time. Big latency win.

If you're running an inference service, the KV cache **is** your dominant resource. Throughput = how many concurrent folder-cabinets fit in GPU memory. Latency = how fast you can read them. Every serving framework you've heard of — vLLM, TGI, TensorRT-LLM, Triton — is largely a story about managing these folders well.

## one breath

- Words become **students** sitting in a row.
- Each student plays three roles via three index cards: **Q** (their question), **K** (their label), **V** (their info).
- The **classroom dance** (attention) is every student asking every other student "how much do you help clarify me?", scored by Q-vs-K match, with each student pulling in a weighted blend of others' V cards.
- Many parallel classrooms (**multi-head**), repeated many rounds (**layers**). Llama 3 8B = 32 classrooms × 32 rounds.
- When **generating**, new students walk in one at a time. Each can only look at students already seated to their left (**causal masking**).
- Existing students' K and V cards never change once written — so we put them in a **folder per student** and reuse them across generation steps. That's the **KV cache**.
- Cache size = `2 × layers × seq_len × kv_heads × head_dim × bytes × batch`. That's the number that decides your inference bill.

If you're going deeper, in this order: Karpathy's [Let's build GPT](https://www.youtube.com/watch?v=kCc8FmEb1nY) (build a transformer in 2 hours, in a notebook); then the [PagedAttention paper](https://arxiv.org/abs/2309.06180) for what production serving actually looks like; then the Llama 3 paper for a worked example of every choice in this post made by people who shipped at scale.

— v
