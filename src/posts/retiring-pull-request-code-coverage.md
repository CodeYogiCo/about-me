---
date: 2026-05-15
tag: notes
title: Retiring pull-request-code-coverage
read: 4 min
deck: Sunsetting a small library we wrote seven years ago to bootstrap test-driven development — and what it taught me about tools.
---

Seven years ago, on a team trying to drag itself toward test-driven development, the principal engineer I worked with wrote a small library called [`pull-request-code-coverage`](https://github.com/target/pull-request-code-coverage). It's been around long enough. Time to retire it.

## the problem we were trying to solve

Most teams that try to adopt TDD hit the same wall: the existing coverage is awful. If you measure the whole codebase, the number is depressingly low and stays that way for months, no matter how much new code you cover. People stop looking at the dashboard. The flywheel never spins up.

The trick was reframing what we measured. Instead of asking *"what's the coverage of the codebase?"* we asked *"what's the coverage of this pull request?"* Just the lines that changed. Just the work being shipped right now.

That meant a team with 8% global coverage could set a 90% bar on new code and watch things improve one PR at a time. No three-quarter heroics. No big-bang test sprints. Just a different denominator.

## why it worked

Two reasons, really:

- **It changed the conversation in code review.** "You added 40 lines, 12 are covered" is a concrete, immediate ask. "Our project is at 23%" is no one's problem.
- **It met teams where they were.** You didn't have to apologize for the legacy. The tool simply ignored it. You were rewarded for the next commit, not punished for the last decade.

We open-sourced it eventually. It got more use than I expected, which felt good.

## why retire it now

Seven years is a long time in tooling. The same idea — diff-aware coverage — is now built into every major coverage tool, every CI provider, every code review platform. Codecov, SonarQube, Coveralls, GitHub's own checks all do it natively, with better integrations and a fraction of the setup our library needed.

When the better-supported alternatives exist, the right move is to send people there. Maintaining a library because you wrote it isn't a reason. It's a habit.

## what it taught me

Two things have stuck:

1. **The most useful tools are reframings, not features.** What changed our test culture wasn't the algorithm — it was the *denominator*. A small idea, well-aimed, did more than any process document ever did.
2. **Open source is a temporary stewardship.** You ship something, you support it while it's the best fit, and you let it go gracefully when it isn't. That isn't failure. That's the lifecycle working correctly.

To the people who used it, contributed, filed issues, sent patches — thank you. To the principal engineer who wrote that first commit: you were right.

— v
