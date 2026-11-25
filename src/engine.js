/**
 * StudyPilot - planning engine.
 *
 * Turns a list of topics plus the student's context (hours available, current
 * energy) into a day-by-day plan, explains every decision, flags topics that
 * will not fit, and recommends what to study right now.
 *
 * Pure functions only: inputs are never mutated and the same input always
 * produces the same plan. Works as a plain <script> (window.StudyEngine) and
 * as a Node module.
 *
 * Vocabulary
 *   block     a 30-minute unit of study
 *   daysLeft  days until that topic's exam; day 0 is today, so a topic with
 *             daysLeft = 1 can only be studied today
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.StudyEngine = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const BLOCK_MINUTES = 30;
  const MAX_BLOCKS_PER_TOPIC_PER_DAY = 2; // at most 1 hour per topic per day: interleaving beats cramming
  const MAX_BLOCKS_NEEDED = 8;
  const URGENCY_WEIGHT = 60;
  const FORCED_BONUS = 1000; // outranks any normal score

  const FOCUS_PROFILE = Object.freeze({
    low: { focusMinutes: 25, breakMinutes: 10 },
    medium: { focusMinutes: 40, breakMinutes: 10 },
    high: { focusMinutes: 50, breakMinutes: 10 },
  });

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  /**
   * How many 30-minute blocks a topic needs: harder topics and lower
   * confidence need more time. Result is between 1 and 8.
   */
  function blocksNeeded(topic) {
    const gap = 6 - topic.confidence; // 1 (confident) .. 5 (lost)
    return clamp(Math.round((topic.difficulty * gap) / 4), 1, MAX_BLOCKS_NEEDED);
  }

  function blocksRemaining(topic) {
    return Math.max(0, blocksNeeded(topic) - (topic.doneBlocks || 0));
  }

  /**
   * Static priority from 0 to 100: weak topics, heavily weighted topics and
   * hard topics rank higher.
   */
  function priorityScore(topic) {
    const gap = (6 - topic.confidence) / 5;
    const weight = topic.importance / 5;
    const hardness = topic.difficulty / 5;
    return Math.round(100 * (0.45 * gap + 0.35 * weight + 0.2 * hardness));
  }

  /** Short, human-readable reason a topic is scheduled on a given day. */
  function explain(topic, day) {
    const reasons = [];
    const daysToExam = topic.daysLeft - day;
    if (daysToExam <= 1) reasons.push('exam is tomorrow or today');
    else if (daysToExam <= 3) reasons.push('exam in ' + daysToExam + ' days');
    if (topic.confidence <= 2) reasons.push('low confidence');
    if (topic.importance >= 4) reasons.push('high exam weight');
    if (topic.difficulty >= 4) reasons.push('hard topic');
    return reasons.length ? reasons.join(', ') : 'steady revision';
  }

  /**
   * Priority that rises as a topic falls behind the pace it needs. A topic
   * that can no longer be finished if it is skipped today is forced to the
   * front, so a last-chance exam is never starved by higher-priority topics.
   */
  function dynamicScore(entry, day) {
    const daysAvailable = Math.max(1, entry.topic.daysLeft - day);
    const pace = entry.remaining / daysAvailable; // blocks per day still required
    const urgency = Math.min(pace / MAX_BLOCKS_PER_TOPIC_PER_DAY, 1);
    const mustStudyToday = entry.remaining > (daysAvailable - 1) * MAX_BLOCKS_PER_TOPIC_PER_DAY;
    return entry.base + URGENCY_WEIGHT * urgency + (mustStudyToday ? FORCED_BONUS : 0);
  }

  function pickNext(entries, day, usedToday) {
    let best = null;
    for (const entry of entries) {
      if (entry.remaining <= 0) continue;
      if (entry.topic.daysLeft <= day) continue; // exam already over
      if ((usedToday.get(entry.topic.name) || 0) >= MAX_BLOCKS_PER_TOPIC_PER_DAY) continue;

      const score = dynamicScore(entry, day);
      const better =
        best === null ||
        score > best.score ||
        (score === best.score && entry.topic.daysLeft < best.entry.topic.daysLeft) ||
        (score === best.score &&
          entry.topic.daysLeft === best.entry.topic.daysLeft &&
          entry.topic.name < best.entry.topic.name);
      if (better) best = { entry: entry, score: score };
    }
    return best ? best.entry : null;
  }

  /**
   * Build the full plan.
   *
   * @param {Array<object>} topics validated topics (see validate.js)
   * @param {{hoursPerDay: number}} context validated study settings
   * @returns {{days: object[], risks: object[], summary: object}}
   */
  function buildPlan(topics, context) {
    if (!Array.isArray(topics) || topics.length === 0) {
      return { days: [], risks: [], summary: emptySummary() };
    }

    const capacity = Math.floor(context.hoursPerDay * 2); // blocks per day
    const entries = topics.map(function (topic) {
      return { topic: topic, remaining: blocksRemaining(topic), base: priorityScore(topic), planned: 0 };
    });
    const horizon = Math.max.apply(null, topics.map(function (t) { return t.daysLeft; }));
    const totalNeeded = entries.reduce(function (sum, e) { return sum + e.remaining; }, 0);

    const days = [];
    for (let day = 0; day < horizon; day++) {
      const usedToday = new Map();
      const order = []; // topic names in the order they were first chosen today
      for (let slot = 0; slot < capacity; slot++) {
        const entry = pickNext(entries, day, usedToday);
        if (!entry) break;
        entry.remaining -= 1;
        entry.planned += 1;
        if (!usedToday.has(entry.topic.name)) order.push(entry);
        usedToday.set(entry.topic.name, (usedToday.get(entry.topic.name) || 0) + 1);
      }

      const sessions = order.map(function (entry) {
        const blocks = usedToday.get(entry.topic.name);
        return {
          topic: entry.topic.name,
          blocks: blocks,
          minutes: blocks * BLOCK_MINUTES,
          difficulty: entry.topic.difficulty,
          daysLeft: entry.topic.daysLeft - day,
          priority: entry.base,
          reason: explain(entry.topic, day),
        };
      });
      days.push({
        day: day,
        sessions: sessions,
        totalMinutes: sessions.reduce(function (sum, s) { return sum + s.minutes; }, 0),
      });
    }

    const risks = entries
      .filter(function (e) { return e.remaining > 0; })
      .map(function (e) {
        return {
          topic: e.topic.name,
          shortfallMinutes: e.remaining * BLOCK_MINUTES,
          daysLeft: e.topic.daysLeft,
        };
      })
      .sort(function (a, b) { return b.shortfallMinutes - a.shortfallMinutes; });

    const shortBlocks = risks.reduce(function (sum, r) { return sum + r.shortfallMinutes / BLOCK_MINUTES; }, 0);
    const plannedBlocks = totalNeeded - shortBlocks;

    return {
      days: days,
      risks: risks,
      summary: {
        totalMinutes: totalNeeded * BLOCK_MINUTES,
        plannedMinutes: plannedBlocks * BLOCK_MINUTES,
        coveragePercent: totalNeeded === 0 ? 100 : Math.round((plannedBlocks / totalNeeded) * 100),
        extraHoursPerDayNeeded: shortBlocks === 0 ? 0 : Math.ceil(shortBlocks / horizon) / 2,
        horizonDays: horizon,
      },
    };
  }

  function emptySummary() {
    return { totalMinutes: 0, plannedMinutes: 0, coveragePercent: 100, extraHoursPerDayNeeded: 0, horizonDays: 0 };
  }

  /**
   * Decide what to study right now, based on today's sessions and how the
   * student feels.
   *   - exam tomorrow or today: always that topic, whatever the energy level
   *   - high energy: the hardest topic scheduled today
   *   - low energy: the easiest topic, in a shorter session
   *   - medium energy: the highest-priority topic
   *
   * @param {{days: object[]}} plan
   * @param {'low'|'medium'|'high'} energy
   * @returns {object} recommendation, or {topic: null, message} when idle
   */
  function nextAction(plan, energy) {
    const profile = FOCUS_PROFILE[energy] || FOCUS_PROFILE.medium;
    const today = plan && plan.days && plan.days[0];
    const sessions = today ? today.sessions : [];
    if (sessions.length === 0) {
      return {
        topic: null,
        message: 'Nothing is scheduled today. Do a light review of your notes, or rest.',
      };
    }

    const byPriority = sessions.slice().sort(function (a, b) { return b.priority - a.priority; });
    const urgent = byPriority.filter(function (s) { return s.daysLeft <= 1; });

    let chosen;
    let why;
    if (urgent.length > 0) {
      chosen = urgent[0];
      why = 'Its exam is tomorrow or today, so it comes first whatever your energy.';
    } else if (energy === 'high') {
      chosen = byPriority.slice().sort(function (a, b) { return b.difficulty - a.difficulty || b.priority - a.priority; })[0];
      why = 'You have high energy, so this is the best time for your hardest topic.';
    } else if (energy === 'low') {
      chosen = byPriority.slice().sort(function (a, b) { return a.difficulty - b.difficulty || b.priority - a.priority; })[0];
      why = 'Your energy is low, so start with the lightest topic and keep the session short.';
    } else {
      chosen = byPriority[0];
      why = 'This is your highest-priority topic today.';
    }

    return {
      topic: chosen.topic,
      focusMinutes: profile.focusMinutes,
      breakMinutes: profile.breakMinutes,
      sessionMinutes: chosen.minutes,
      reason: chosen.reason,
      message: why,
    };
  }

  /**
   * Record finished study blocks against topics. Returns new topic objects.
   * @param {object[]} topics
   * @param {Object<string, number>} doneByTopic blocks completed per topic name
   */
  function applyProgress(topics, doneByTopic) {
    return topics.map(function (topic) {
      const extra = doneByTopic && doneByTopic[topic.name] ? doneByTopic[topic.name] : 0;
      const done = clamp((topic.doneBlocks || 0) + extra, 0, blocksNeeded(topic));
      return Object.assign({}, topic, { doneBlocks: done });
    });
  }

  /**
   * Move the calendar forward one day: every exam gets one day closer, and
   * topics whose exam has now passed are removed.
   */
  function advanceDay(topics) {
    return topics
      .map(function (topic) { return Object.assign({}, topic, { daysLeft: topic.daysLeft - 1 }); })
      .filter(function (topic) { return topic.daysLeft >= 1; });
  }

  return {
    BLOCK_MINUTES: BLOCK_MINUTES,
    MAX_BLOCKS_PER_TOPIC_PER_DAY: MAX_BLOCKS_PER_TOPIC_PER_DAY,
    blocksNeeded: blocksNeeded,
    blocksRemaining: blocksRemaining,
    priorityScore: priorityScore,
    explain: explain,
    buildPlan: buildPlan,
    nextAction: nextAction,
    applyProgress: applyProgress,
    advanceDay: advanceDay,
  };
});
