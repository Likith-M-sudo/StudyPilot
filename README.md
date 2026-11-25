# StudyPilot

An adaptive study-planning assistant. Tell it your exams, how hard each topic feels, how much time you have and how much energy you have today. It builds a day-by-day plan, explains every choice, tells you what to study **right now**, and re-plans when you fall behind.

## Chosen vertical

**Education: student productivity and exam preparation.**

## Problem statement

Students juggle several exams with limited hours. Static timetables break the first time a session is missed, they ignore how the student feels that day, and they never say why a topic is scheduled. The result is wasted hours on comfortable topics and last-minute panic on the ones that matter.

**StudyPilot solves this by making the plan a decision, not a list.** It weighs each topic by exam date, difficulty, confidence and exam weight, adapts to current energy, flags what will not fit, and recalculates from real progress.

## How it works

1. **Set your day.** Enter study hours per day and your current energy (low, medium, high).
2. **Add topics.** For each one: days until its exam, difficulty (1-5), your confidence (1-5) and exam weight (1-5).
3. **Build my plan.** You get:
   - a **Study this now** card with the recommended topic, focus and break length, and the reason
   - a **day-by-day plan** with a plain-language "Why" for every session
   - a **heads-up panel** if some topics cannot fit before their exams, with how much extra time would fix it
4. **Tick sessions as you finish them**, then choose **Re-plan with my progress** or **Start next day**. Missed work is spread across the days that remain.

Changing the energy level or daily hours updates the plan instantly.

## Approach and logic

All decision logic lives in [`src/engine.js`](src/engine.js) as pure, deterministic functions.

**Time needed.** Study time is counted in 30-minute blocks:
`blocks = round(difficulty x (6 - confidence) / 4)`, limited to 1-8. Hard topics you feel unsure about need the most.

**Priority score (0-100).** `45% weakness + 35% exam weight + 20% difficulty`.

**Scheduling.** Each day, blocks are handed out one at a time to the topic with the highest dynamic score:

- the static priority, plus
- an **urgency** term that grows as a topic falls behind the pace it needs to finish before its exam, plus
- a **must-study-today** override for any topic that could no longer be finished if skipped today. This guarantees a last-chance exam is never starved by higher-priority topics.

A topic is never scheduled on or after its exam day, and never gets more than one hour a day. This forces interleaving, which is better for retention than cramming.

**Context-aware recommendation ("Study this now").**

| Situation | Decision |
| --- | --- |
| A topic's exam is tomorrow or today | That topic, regardless of energy |
| High energy | The hardest topic scheduled today |
| Low energy | The easiest topic, with a shorter 25-minute focus session |
| Medium energy | The highest-priority topic, 40-minute sessions |

**Risk detection.** If a topic's remaining blocks cannot fit before its exam, it is reported with the exact shortfall and the extra hours per day that should cover it.

**Adaptive re-planning.** Ticked sessions are recorded as progress, remaining work is recalculated, and the plan is rebuilt. "Start next day" also moves every exam one day closer and drops finished topics.

## Assumptions

- A study block is 30 minutes and a topic needs between 30 minutes and 4 hours in total.
- "Days until exam" counts today as day 0, so `1` means tomorrow and the topic can only be studied today.
- The student studies every day up to the hours entered; weekends and rest days are not modelled.
- Difficulty, confidence and exam weight are the student's own honest 1-5 ratings.
- Up to 12 topics and 30 days ahead are planned at once.
- Progress is tracked by the student ticking sessions; nothing is detected automatically.

## Security

- **No innerHTML anywhere.** All user text is rendered as plain text nodes, so injected markup is displayed as harmless text.
- **Strict Content-Security-Policy** (`default-src 'none'`, scripts and styles only from the same origin, no inline code, no `eval`).
- **All input is validated and sanitised** in [`src/validate.js`](src/validate.js): types, ranges, whole numbers, length caps, control-character stripping, duplicate and topic-count limits.
- **Saved data is re-validated on load**, so tampered browser storage cannot crash or exploit the app.
- No network requests, no third-party scripts, no API keys, no accounts. Data stays in the browser.

## Accessibility

- Semantic landmarks (`header`, `main`, `footer`), a correct heading order and a skip link.
- Every field has a visible label and hint; radio buttons are grouped in a `fieldset` with a `legend`.
- Errors use `role="alert"`; status messages and progress use polite live regions; focus moves to the results after building a plan and back to the form after removing a topic.
- Fully keyboard operable with a high-contrast, always-visible focus ring.
- AA text contrast, 44px minimum touch targets, responsive down to phone width, `prefers-reduced-motion` respected.
- Colour is never the only signal: every coloured block is paired with the topic name in text.

## Efficiency

The planner runs in `O(days x blocks per day x topics)`, which is at most about 8,600 steps (30 x 24 x 12). It has no dependencies, no build step and no network calls, and the whole app is under 60 KB.

## Testing

Tests use Node's built-in runner, with no packages to install:

```bash
npm test        # or: node --test
```

They cover:

- the engine: time estimates, priority, daily capacity, per-topic caps, exam deadlines, last-chance scheduling, risk flags, energy-aware topic ordering, progress persistence, next-day, determinism and no mutation of inputs
- validation: sanitising, ranges, bad types, duplicates, caps, tampered progress
- the page: labels for every field, unique ids, live regions, CSP rules, no inline code, no unsafe DOM APIs, no secrets, and that every element the UI code looks up exists

## Run it

Open `index.html` in a browser, or serve the folder:

```bash
npm start       # python3 -m http.server 8000, then open http://localhost:8000
```

It also works as-is on GitHub Pages.

## Deploy to Google Cloud Run

The repo includes a `Dockerfile` (nginx serving the static files) so it deploys straight from source:

```bash
gcloud config set project YOUR_PROJECT_ID
gcloud run deploy studypilot --source . --region asia-south1 --allow-unauthenticated
```

Cloud Run prints the public service URL when the deploy finishes. The container also sends security headers (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`).

## Project structure

```
index.html          page markup
Dockerfile          container image for Cloud Run
nginx.conf.template web server config (port and security headers)
styles.css          styles
src/validate.js     input validation and sanitising
src/engine.js       planning and decision logic (pure functions)
src/app.js          UI controller
tests/              engine, validation and page tests
```

## Limitations and next steps

- No calendar export or notifications yet.
- Weekends and fixed commitments are not modelled.
- Confidence ratings are manual; a future version could update them from quiz results. Energy changes the order and explanation of suitable sessions without exceeding the student's stated daily time budget. Checked sessions are saved locally so a refresh does not silently discard progress.
