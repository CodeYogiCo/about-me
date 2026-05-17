---
date: 2026-05-16
tag: systems
title: "The KV cache, from first principles"
read: 8 min
deck: "How attention and the KV cache actually work — from the basics up."
---

The number that decides how much your LLM inference bill is doesn't appear on the model card. It isn't the parameter count. It isn't the context length. It's the **KV cache** — a per-request scratchpad in GPU memory that grows with every word the model generates.

If you serve models, this is the dominant resource you're managing. Every recent inference trick exists to shrink it.

This post explains what the KV cache is from scratch, using a simple analogy.

## what an LLM does, in one line

A language model takes the words you've written so far and predicts the next word. That's it. Chat, code generation, agents — everything is this one trick called in a loop.

```
input:  "The quick brown ___"
output: "fox" (95% likely)
        "dog" (3%)
        …
```

Pick one, append it, repeat. That's how an LLM writes a paragraph — one word at a time, each one a guess at what comes next.

## words become numbers from a fixed list

Models don't see text — they see numbers. Before anything else, the model breaks your sentence into chunks from a fixed list of about 50,000 known chunks (called **tokens**). Common words like "the" are one chunk. Rare words like "tokenization" get split into a few chunks ("token" + "ization") because the model has those but not the whole word.

You can watch this happen live at [tiktokenizer.vercel.app](https://tiktokenizer.vercel.app/?model=cl100k_base) — paste anything.

That's all you need to know about tokenization. The interesting part starts now.

## the library

Imagine your sentence is a small library, with one book per word on the shelf.

```
[the] [cat] [sat] [on] [the] [mat]
```

When you want to understand any single book — say, "sat" — you can't just look at it in isolation. The word "sat" could mean a hundred things (sat for an exam, sat in a chair, …). You need to understand it in the context of the other books on the shelf.

The library has a **catalog**. Every book has an entry in the catalog with two cards:

- A **title card (K)** — what the book advertises itself as. *"I'm an action verb. I'm about sitting."*
- A **contents card (V)** — what the book actually delivers if matched. *"Action of sitting, past tense, requires a subject and a location."*

And every book also has its own **question (Q)** — what it needs to know to understand its place in this library:

- "sat" asks: *"What's the subject doing me? Where's it happening?"*
- "cat" asks: *"What action am I taking? Where am I?"*
- "the" asks (a small question): *"Which noun am I attached to?"*

To answer each book's question, the model browses the catalog:

For "sat" specifically:

- "cat"'s title card says *"subject, noun, animal"* → **high match** → pull in lots of "cat"'s contents card
- "on"'s title card says *"position word"* → **high match** → pull in lots of "on"'s contents
- "the"'s title card says *"just a determiner"* → **low match** → pull in almost nothing
- "mat"'s title card says *"noun being acted on"* → **medium match** → pull in some of "mat"'s contents

The combined result — a blend of contents weighted by how well each title matched — is the new "sat". It's no longer the abstract verb "sat", it carries context: *a sitting action done by a cat onto a mat*. Every other book on the shelf gets the same treatment in parallel, each using its own question against everyone else's title cards.

**Q asks. K announces. V delivers.**

That's attention — the engine of every modern language model. The 2017 paper that introduced it is [Attention Is All You Need](https://arxiv.org/abs/1706.03762) — eight authors, eleven pages.

(In the actual model, the cards aren't paper — they're short lists of numbers. But the role each plays is exactly what the analogy says.)

## doing it many times, in parallel

One catalog focuses on one type of relationship between books (maybe grammar — who's the subject of what verb). To capture different kinds of relationships — meaning, position, long-range references — the model maintains **many parallel catalogs at once**. Llama 3 8B has 32 of them.

Then it does the whole browsing-and-combining process again, this time using the previous round's enriched results. And again. **Stacked 32 layers deep.** Each layer refines the previous layer's understanding.

By layer 32, every book has a deeply layered understanding of its place in the library.

## generating one word at a time

To write the next word, the model:

1. Runs all 32 layers of browsing and combining over the existing books.
2. Looks at the last book's final understanding.
3. Turns that into a probability over every word in the vocabulary.
4. Picks one — usually the most likely.
5. Adds that word's book to the end of the shelf.
6. Goes back to step 1, now with one more book on the shelf.

One rule when generating: **each book can only consult catalog entries for books to its left.** It can't peek at books that haven't been placed yet — those are what's being predicted. This means every book's catalog entry depends only on books to its left, never on anything to its right. **Once a book's entry is in the catalog, it never changes.**

That property is the opening for the optimization.

## the KV cache

Here's the thing nobody tells you up front: **the model doesn't remember anything between words.** When it generates the next word, it doesn't pick up where it left off — it starts the whole sentence over from the beginning.

Every single word the model generates means going through every existing book again and re-generating every book's catalog entry. Just to add *one* new word at the end.

Imagine, every time a new book arrives at the shelf, throwing out the entire catalog and re-cataloging every existing book from scratch — including all 1,000 books that have been on the shelf for years.

Why does it work this way? Because each prediction is a self-contained calculation: *"given the sentence so far, what comes next?"* The "given the sentence so far" part is rebuilt every time. The model has no built-in memory between predictions.

For a 3-word sentence, that means re-cataloging 3 books to get word #4. For a 1,000-word sentence, re-cataloging 1,000 books to get word #1,001. The cost gets brutal fast.

But notice: **every existing book's catalog entry would come out identical every single time.** Each entry depends only on books to its left, and nothing to its left has changed. So re-cataloging is pure wasted work.

The fix is obvious once you see it: **keep the catalog.** After each book's title and contents cards are generated the first time, save them. Next time we add a new word, only the brand-new book needs a fresh catalog entry. All the old ones are still on file.

That saved catalog is the **KV cache**.

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

Now each generation step only requires the brand-new book to write its catalog entry. The library doesn't get re-cataloged from scratch every time. Generation stays fast even as the sentence grows.

It's safe to cache because each catalog entry is **frozen once written**. A book's K and V depend only on books to its left. Nothing to its right (which is what's being added) can ever change them. So a cached entry can never go stale.

The only question is: how much memory does the catalog take?

## the memory cost

This is where the inference bill lives.

There's a catalog entry per book, per layer, per parallel catalog. For a typical 7B model:

- ~32 layers
- ~32 parallel catalogs per layer
- ~128 numbers per card

That works out to about **0.5 MB per book**, per conversation. A 4,000-word conversation: **~2 GB of GPU memory per concurrent user**, just for the catalog.

Try the numbers yourself:

<div data-widget="kv-cache-calc"></div>

A few things worth playing with:

- Switch from **Llama 2 7B** to **Llama 3 8B**. Total memory drops 4× — Llama 3 uses a catalog-shrinking trick (read on).
- Bump **seq length** from 4k to 32k. The catalog grows linearly with the number of books on the shelf. This is why long-context models are expensive even when the model itself is unchanged.
- Bump **batch** to 32 (serving 32 conversations at once). You pay 32× the memory. This is when the catalog starts to dominate GPU memory — not the model weights.
- Switch **dtype** to int8. Catalog size halves. Tiny accuracy hit, big memory win.

## why everyone's optimizing the catalog

Every modern inference innovation is some variation on shrinking the catalog:

- **GQA (Grouped-Query Attention)** — instead of every question-asker having its own dedicated title and contents cards, *groups* of questions share one set of cards. Fewer entries to store. Used by Llama 2 70B, Llama 3, Mistral.
- **Sliding-window attention** — only keep catalog entries for the last *w* books. Older books "leave the library." Bounded memory, less long-range memory.
- **Quantized KV cache** — write the catalog entries in shorthand (int8 or int4 instead of fp16). Half or quarter the memory at modest quality cost.
- **Prefix caching** — if many conversations start with the same intro ("You are a helpful assistant…"), share those catalog entries across conversations.

If you're running an inference service, the KV cache **is** your dominant resource. Every serving framework you've heard of — vLLM, TGI, TensorRT-LLM — is mostly a story about managing the catalog well.

## one breath

- Your sentence is a **library**, one **book** per word.
- Every book has three things: a **question (Q)**, a **title card (K)**, and a **contents card (V)**.
- **Attention** = for every book, match its question against every other book's title card, pull in their contents weighted by how well the titles matched.
- Many parallel catalogs (heads), repeated many layers — Llama 3 8B = 32 × 32.
- When generating, new books get added to the shelf one at a time; each can only consult books already on the shelf to its left.
- Existing books' catalog entries never change — so we save them in **the catalog** and reuse them across generation steps. **That's the KV cache.**
- The catalog dominates inference memory. Shrinking it is most of what serving frameworks do.

If you want to go deeper later: Karpathy's [Let's build GPT](https://www.youtube.com/watch?v=kCc8FmEb1nY) is a 2-hour notebook walkthrough that builds a transformer from scratch. Best next step.

— v
