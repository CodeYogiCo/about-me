---
date: 2026-04-22
tag: systems
title: "Designing for search at scale: notes from the trenches"
read: 12 min
deck: "What I keep relearning about index layout, query planning, and the cost of being clever."
---

I've spent most of the last decade thinking about search. The job is older than I am, the literature is enormous, and yet every system I've built has surprised me at least once. The thing that keeps surprising me is how much of search is not algorithms. It's schema. It's capacity. It's the reluctance of the world to fit into clean abstractions.

What follows is a tour of the lessons I keep relearning — the ones I'd tell a younger version of myself, if he'd listen.

## indexing is half the system

The query is the part everyone shows you. The index is the part you live with. A good index lets you write boring queries and still answer in milliseconds; a bad index forces every layer above it into heroics.

When I review a search system, I look at the index first. How is it laid out on disk? What does a single segment cost to load? How are deletes represented? What does the merge schedule look like under steady-state write pressure? You can usually tell within ten minutes whether the system was designed by someone who's been on-call for it.

> An index is a contract with your future self about which questions are cheap.

## the cost of being clever

Every clever optimization is a tax on the next person who reads the code. Sometimes the tax is worth it — a 10x latency win on the hot path is a real thing. But I've shipped "clever" ranking tricks that I, personally, could not explain six months later. That's a smell.

My current rule: if I can't draw the optimization on a whiteboard in two minutes, it doesn't go in.

## queries lie

Users don't type what they mean. They type a fragment of what they mean, then look at the results to figure out what they actually wanted. Search is a conversation, not a function call.

The implication is that latency matters more than you think. If the system answers in 30ms, the user can iterate four times in the time it takes to read this paragraph. If it answers in 800ms, they'll give up.

## what i'd do tomorrow

- Make the index format boring. Boring is debuggable.
- Build the offline evaluation harness before the ranker.
- Spend a full week reading query logs before changing anything.
- Write down the failure mode of every component before shipping it.

None of this is novel. All of it is hard. That's the job.
