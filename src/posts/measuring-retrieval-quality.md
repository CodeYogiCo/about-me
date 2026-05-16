---
date: 2026-05-16
tag: search
title: "Measuring retrieval quality: NDCG, MRR, and friends"
read: 9 min
deck: "A working guide to the metrics that actually drive ranking decisions — with two small calculators you can play with."
hidden: true
---

You can't improve a ranker if you can't measure it. That sounds obvious, but most teams I've worked with measure the wrong thing or measure the right thing badly, and then wonder why their offline experiments don't predict online behavior.

This post walks through the metrics that actually drive retrieval decisions — what they tell you, what they don't, and when to reach for each. There are two small calculators embedded below; play with them. Intuition lives in the fingers.

## the setup

Every retrieval metric is asking the same shape of question:

> Given a query and the ordered list of results I returned, how good is it?

What changes is how you define "good":

- **Did we find anything relevant at all?** → hit@k
- **Did we find most of the relevant things?** → recall@k
- **How many of our top results were relevant?** → precision@k
- **How quickly did we get to the first good result?** → MRR
- **How well did we order the relevant things?** → NDCG, MAP

The right metric depends on the *job your retriever is doing*. A search box where the user picks one result is a different problem from a recall layer feeding a ranker, which is a different problem again from a recommender that surfaces ten items at once.

## hit@k, recall@k, precision@k — the simple ones

The cheapest metrics. They treat relevance as **binary** (relevant or not) and ignore order *within* the top-k.

- **hit@k**: 1 if at least one relevant result is in the top-k, else 0. Average across queries. Tells you *did the user have any chance at all.*
- **recall@k**: (# relevant in top-k) / (# total relevant). Tells you *what fraction of the good stuff we surfaced.*
- **precision@k**: (# relevant in top-k) / k. Tells you *how clean our top-k was.*

These are most useful when you're building the **recall stage** of a two-stage system. There you only care whether the right candidates are in the pool — the second-stage ranker decides their order. Recall@100 or recall@500 is the contract between stages.

They're a poor fit for the user-facing ranker, because position matters and they don't see it. A result at rank 1 and a result at rank 10 score the same.

## MRR — when only the first relevant result matters

**Mean Reciprocal Rank** asks: *how far down the list did the user have to scan to hit the first relevant thing?*

For each query, find the rank of the first relevant result. Take its reciprocal: `1/rank`. If no relevant result was returned, that query's score is 0. Average across queries.

```
MRR = (1/|Q|) · Σ_q (1 / rank_q)
```

- rank 1 → 1.000
- rank 2 → 0.500
- rank 3 → 0.333
- rank 10 → 0.100
- not found → 0

The reciprocal makes MRR very sensitive to the top positions. Moving a result from rank 5 to rank 1 is worth a lot more than moving it from rank 50 to rank 46.

**Use MRR when:**
- The user wants one answer (a search box, a tool autocomplete, a "did you mean" suggestion).
- There's usually exactly one correct result per query.
- You don't care about results beyond the first relevant one.

**Don't use MRR when:**
- The user is browsing multiple results (you'll be blind to everything except the first).
- Relevance has degrees (MRR is binary — it ignores how relevant the other results were).

Try it:

<div data-widget="mrr-calc"></div>

Move one of the early queries' rank from 1 to 3 — watch the MRR drop. Now move a query at rank 5 to rank 2 — the same magnitude of movement, very different impact.

## NDCG — when ranking quality matters

**Normalized Discounted Cumulative Gain** is the metric most modern rankers optimize against. It does three useful things at once:

1. **Graded relevance.** Results aren't just relevant/not. They can be `0` (not relevant), `1` (marginal), `2` (relevant), `3` (highly relevant), etc. The metric uses the full scale.
2. **Position discounting.** A result at rank 1 contributes more than the same result at rank 5. The discount is `1 / log₂(rank + 1)`.
3. **Normalization.** The score is divided by the *best possible* score for those same relevance values, so NDCG always lives in `[0, 1]`. NDCG of 1 means "you returned the optimal ranking of these results."

The formula:

```
DCG  = Σ_i  (2^rel_i − 1) / log₂(i + 1)        // i = 1-indexed rank
IDCG = DCG of the same scores sorted descending
NDCG = DCG / IDCG
```

The `2^rel − 1` term is the Burges variant — it weights highly-relevant results disproportionately, which matches how users actually experience search quality. (The simpler `rel_i / log₂(i+1)` form is also seen in older papers.)

Try it:

<div data-widget="ndcg-calc"></div>

A few things to notice as you play:

- Putting a `3` (highly relevant) at rank 1 contributes 7 to DCG. The same `3` at rank 5 contributes only ~2.7. **Position dominates.**
- Adding more `0`s at the bottom doesn't change DCG or IDCG (they contribute zero). Adding more `0`s near the top *does* hurt — they push relevant results down.
- NDCG = 1.0 only when your ranking equals the ideal ranking of those same scores. Note: it can equal 1.0 even when results are weak — NDCG measures *ordering*, not absolute quality. If all results are `0`, NDCG is undefined (0/0); treat it as 0 by convention.

**Use NDCG when:**
- You have graded relevance labels (or can synthesize them, e.g., from clicks weighted by dwell time).
- You're optimizing a user-facing ranker where order matters.
- You want one number per query that captures "is this ranking any good."

**Don't use NDCG when:**
- You only have binary judgments — MAP or precision@k tell you more.
- You're measuring a recall-stage retriever — use recall@k instead.

## MAP — when binary relevance is all you have

**Mean Average Precision.** For each query, walk down the ranked list and average the precision@k values *computed at every rank where a relevant result appears*. Then average across queries.

Worked example. Suppose for one query the top 6 results are relevant/not as: `[R, R, N, R, N, N]`. The relevant results are at ranks 1, 2, 4. Compute precision at each:

- rank 1: 1/1 = 1.000
- rank 2: 2/2 = 1.000
- rank 4: 3/4 = 0.750

Average: `(1 + 1 + 0.75) / 3 = 0.917`. That's average precision for this query. MAP is the mean of this across all queries.

MAP rewards both **finding** relevant results and **ranking them near the top**. It's binary, so it can't distinguish "highly relevant" from "barely relevant" — that's what NDCG is for.

**Use MAP when:**
- You have binary relevance labels.
- You care about the full ranked list, not just the first result (so MRR isn't enough).

## which metric when, in one table

| your job | metric |
|---|---|
| recall stage feeding a ranker | recall@k |
| user-facing ranker, graded labels | NDCG@k |
| user-facing ranker, binary labels | MAP, precision@k |
| one-answer search (autocomplete, jump-to) | MRR |
| "did we surface anything?" | hit@k |
| diagnosing why NDCG moved | look at per-position contributions (the calculator above) |

## a few things you only learn after shipping

A few things I keep relearning when these metrics start driving real decisions:

- **The offline metric is a proxy, not the truth.** A 2-point NDCG gain in the eval set that doesn't move CTR online means your eval set wasn't representative of production traffic. Re-check the labels and the query mix before celebrating.
- **Average everything per-query, not per-result.** A few queries with thousands of relevant results will dominate any metric averaged the wrong way. Normalize first, then average across queries.
- **Confidence intervals matter.** A 0.005 NDCG difference between two systems is noise unless you've measured it with enough queries and paired-bootstrapped a CI. "Bigger number" isn't progress.
- **Eval-set drift is real.** Your eval queries age. Refresh them on a calendar, or they'll quietly stop predicting reality.

Build the offline harness before you build the ranker. The harness is the part that compounds; the ranker is the part that changes every quarter.

— v
