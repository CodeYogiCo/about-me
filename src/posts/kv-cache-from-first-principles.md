---
date: 2026-05-16
tag: systems
title: "The KV cache, from first principles"
read: 8 min
deck: "How attention and the KV cache actually work — explained with a classroom of students. No math required."
---

The number that decides how much your LLM inference bill is doesn't appear on the model card. It isn't the parameter count. It isn't the context length. It's the **KV cache** — a per-request scratchpad in GPU memory that grows with every word the model generates.

If you serve models, this is the dominant resource you're managing. Every recent inference trick exists to shrink it.

This post explains what the KV cache is from scratch, with a classroom of students. No math. No prior ML knowledge needed.

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

## the classroom

Imagine each word in your sentence is a student, sitting in a row.

```
the   cat   sat   on   the   mat
```

The principal claps and says: *"each of you, figure out what you mean in this exact sentence."*

Student "sat" can't do that alone — by itself it could mean a hundred things (sat for an exam, sat in a chair, …). It needs to look at the other students and pull in context. So does every other student.

To do that, every student walks in carrying **three index cards**:

- **Q card** — the question this student is asking. *"Who's doing me? Where's it happening?"*
- **K card** — the label this student advertises to others. *"I'm a subject! I'm a verb!"*
- **V card** — the actual info this student shares if matched. *"Animal, four legs, mammal, often a pet…"*

The dance, all students at once:

1. Hold up your **Q card** — *"here's what I'm asking."*
2. Look at every other student's **K card**.
3. Score how well each K matches your Q (high = relevant, low = not).
4. Pull in each student's **V card** content, weighted by those scores.

For "sat":

- "cat" advertises *"subject!"* → high match → "sat" pulls in lots of "cat" info
- "on" advertises *"position word!"* → high match → pulls in lots of "on" info
- "the" advertises *"just a determiner"* → low match → pulls in almost nothing

After the dance, "sat" understands itself in context — *a sitting action done by a cat onto a mat*. Every other student does the exact same dance at the exact same time.

**Q asks. K announces. V delivers.**

That's attention — the engine of every modern language model. The 2017 paper that introduced it is [Attention Is All You Need](https://arxiv.org/abs/1706.03762) — eight authors, eleven pages.

(The "cards" aren't really paper — they're short lists of numbers. But the role each plays is exactly what the analogy says.)

## doing it many times, in parallel

One classroom focuses on one type of relationship (maybe grammar — who's the subject of what verb). To capture different kinds — meaning, position, long-range references — the model runs **many parallel classrooms at once**. Llama 3 8B has 32 of them.

Then it runs another set of 32 parallel classrooms. And another. **Stacked 32 layers deep.** Each layer's dance happens on the *output* of the previous one, so context compounds.

In layer 1, "sat" picks up basic context. By layer 32, every student has a deeply layered understanding of its role in the sentence.

## generating one word at a time

To write the next word, the model:

1. Runs all 32 layers of the dance over the existing words.
2. Looks at the last student's final understanding.
3. Turns that into a probability over every word in the vocabulary.
4. Picks one — usually the most likely.
5. Calls that word as the next student. They walk in and sit down.
6. Goes back to step 1, now with one more student in the row.

This is how an LLM writes a paragraph — type a sentence, generate one word, re-run all 32 layers, generate another word, and so on.

One rule when generating: **each new student can only look at students to their left.** They can't peek at empty chairs to their right — those students haven't been called yet (that's what we're predicting). This means existing students' cards never depend on anyone who arrives later. **Once a student writes their K and V cards, those cards never change.**

That property is the opening for the optimization that makes LLMs practical to serve.

## the KV cache

Without any caching, every time a new student joins the row, every existing student has to **rewrite** their cards from scratch — even though their cards never actually change. That's pure wasted work, and it gets worse as the sentence grows.

**The fix:** give every student a folder. The first time they write their K and V cards (in each of the 32 layers), the cards go in their folder. From then on, when their cards are needed, they just hand over the folder.

That folder is the **KV cache**.

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

Each new generation step only requires the brand-new student to write fresh cards. Everyone else just hands over their folder. Generation goes from painfully slow to fast.

It works for the same reason database query caching works: the cached values are *immutable* once written. No invalidation logic, no cache-consistency dance. The only question is: how much memory do all these folders take?

## the memory cost

This is where the inference bill lives.

There's a folder per student, per layer, per parallel classroom. For a typical 7B model:

- ~32 layers
- ~32 parallel classrooms per layer
- ~128 numbers per card

That works out to about **0.5 MB per student**, per conversation. A 4,000-word conversation: **~2 GB of GPU memory per concurrent user**, just for the folders.

Try the numbers yourself:

<div data-widget="kv-cache-calc"></div>

A few things worth playing with:

- Switch from **Llama 2 7B** to **Llama 3 8B**. Total memory drops 4× — Llama 3 uses a folder-shrinking trick (read on).
- Bump **seq length** from 4k to 32k. Folders grow linearly with the row length. This is why long-context models are expensive even when the model itself hasn't changed.
- Bump **batch** to 32 (serving 32 conversations at once). You pay 32× the memory. This is when folders start to dominate GPU memory — not the model weights.
- Switch **dtype** to int8. Folder size halves. Tiny accuracy hit, big memory win.

## why everyone's optimizing the folders

Every modern inference innovation is some variation on shrinking the folders:

- **GQA (Grouped-Query Attention)** — instead of every student-asker having their own dedicated K/V advertiser, *groups* of askers share one advertiser. Fewer folders. Used by Llama 2 70B, Llama 3, Mistral.
- **Sliding-window attention** — only keep the last *w* students' folders. Older students "leave the room." Bounded memory, less long-range memory.
- **Quantized KV cache** — write the cards in shorthand (int8 or int4 instead of fp16). Half or quarter the memory at modest quality cost.
- **Prefix caching** — if many conversations start with the same intro ("You are a helpful assistant…"), share those folders across conversations.

If you're running an inference service, the KV cache **is** your dominant resource. Every serving framework you've heard of — vLLM, TGI, TensorRT-LLM — is mostly a story about managing these folders well.

## one breath

- Words become **students** in a row.
- Each student plays three roles via three cards: **Q** (their question), **K** (their label), **V** (their info).
- **Attention** = every student asks every other "how much do you help clarify me?", scored by Q-vs-K matches, blending in everyone's V cards.
- Many parallel classrooms (heads), repeated many layers — Llama 3 8B = 32 × 32.
- When generating, new students walk in one at a time; each only looks at students already seated to their left.
- Past students' K and V cards never change — so we put them in **folders** and reuse them. **That's the KV cache.**
- Folders dominate inference memory. Shrinking them is most of what serving frameworks do.

If you want to go deeper later: Karpathy's [Let's build GPT](https://www.youtube.com/watch?v=kCc8FmEb1nY) is a 2-hour notebook walkthrough that builds a transformer from scratch. Best next step.

— v
