'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../src/engine.js');

function topic(overrides) {
  return Object.assign(
    { name: 'Topic', daysLeft: 7, difficulty: 3, confidence: 3, importance: 3, doneBlocks: 0 },
    overrides
  );
}

test('blocksNeeded grows with difficulty and falls with confidence', () => {
  assert.equal(E.blocksNeeded(topic({ difficulty: 5, confidence: 1 })), 6);
  assert.equal(E.blocksNeeded(topic({ difficulty: 1, confidence: 5 })), 1);
  assert.ok(
    E.blocksNeeded(topic({ difficulty: 4, confidence: 1 })) >
      E.blocksNeeded(topic({ difficulty: 4, confidence: 4 }))
  );
});

test('blocksNeeded always stays between 1 and 8', () => {
  for (let d = 1; d <= 5; d++) {
    for (let c = 1; c <= 5; c++) {
      const n = E.blocksNeeded(topic({ difficulty: d, confidence: c }));
      assert.ok(n >= 1 && n <= 8, 'out of range for d=' + d + ' c=' + c);
    }
  }
});

test('priorityScore ranks weak, heavy, hard topics highest', () => {
  const weak = E.priorityScore(topic({ confidence: 1, importance: 5, difficulty: 5 }));
  const strong = E.priorityScore(topic({ confidence: 5, importance: 1, difficulty: 1 }));
  assert.ok(weak > strong);
  assert.ok(weak <= 100 && strong >= 0);
});


test('buildPlan adapts topic order to current energy without exceeding the time budget', () => {
  const topics = [
    topic({ name: 'Easy', daysLeft: 5, difficulty: 1, confidence: 3, importance: 3 }),
    topic({ name: 'Hard', daysLeft: 5, difficulty: 5, confidence: 3, importance: 3 }),
  ];
  const low = E.buildPlan(topics, { hoursPerDay: 1, energy: 'low' });
  const high = E.buildPlan(topics, { hoursPerDay: 1, energy: 'high' });
  assert.equal(low.days[0].sessions[0].topic, 'Easy');
  assert.equal(high.days[0].sessions[0].topic, 'Hard');
  low.days.concat(high.days).forEach((day) => assert.ok(day.totalMinutes <= 60));
  assert.match(low.days[0].sessions[0].reason, /low energy/);
  assert.match(high.days[0].sessions[0].reason, /high energy/);
});

test('buildPlan returns an empty plan for no topics', () => {
  const plan = E.buildPlan([], { hoursPerDay: 3 });
  assert.deepEqual(plan.days, []);
  assert.deepEqual(plan.risks, []);
  assert.equal(plan.summary.coveragePercent, 100);
});

test('buildPlan never exceeds the daily time budget', () => {
  const topics = [
    topic({ name: 'A', difficulty: 5, confidence: 1 }),
    topic({ name: 'B', difficulty: 5, confidence: 1 }),
    topic({ name: 'C', difficulty: 5, confidence: 1 }),
  ];
  const plan = E.buildPlan(topics, { hoursPerDay: 2 });
  plan.days.forEach((day) => assert.ok(day.totalMinutes <= 120));
});

test('buildPlan caps a single topic per day', () => {
  const plan = E.buildPlan([topic({ name: 'Only', difficulty: 5, confidence: 1, daysLeft: 5 })], { hoursPerDay: 8 });
  plan.days.forEach((day) =>
    day.sessions.forEach((s) => assert.ok(s.blocks <= E.MAX_BLOCKS_PER_TOPIC_PER_DAY))
  );
});

test('buildPlan never schedules a topic on or after its exam day', () => {
  const plan = E.buildPlan(
    [topic({ name: 'Soon', daysLeft: 2, difficulty: 5, confidence: 1 }), topic({ name: 'Later', daysLeft: 6 })],
    { hoursPerDay: 4 }
  );
  plan.days.forEach((day) => {
    day.sessions.forEach((s) => {
      if (s.topic === 'Soon') assert.ok(day.day < 2, 'Soon scheduled on day ' + day.day);
    });
  });
});

test('buildPlan puts an imminent exam ahead of a distant one', () => {
  const plan = E.buildPlan(
    [
      topic({ name: 'Distant', daysLeft: 20, confidence: 3, importance: 3 }),
      topic({ name: 'Imminent', daysLeft: 2, confidence: 3, importance: 3, difficulty: 4 }),
    ],
    { hoursPerDay: 2 }
  );
  assert.equal(plan.days[0].sessions[0].topic, 'Imminent');
});

test('buildPlan flags topics that cannot fit and suggests extra time', () => {
  const plan = E.buildPlan(
    [topic({ name: 'Huge', daysLeft: 1, difficulty: 5, confidence: 1 })],
    { hoursPerDay: 8 }
  );
  assert.equal(plan.risks.length, 1);
  assert.equal(plan.risks[0].topic, 'Huge');
  assert.ok(plan.risks[0].shortfallMinutes > 0);
  assert.ok(plan.summary.coveragePercent < 100);
});

test('buildPlan reports no risks when everything fits', () => {
  const plan = E.buildPlan([topic({ name: 'Easy', difficulty: 1, confidence: 5 })], { hoursPerDay: 2 });
  assert.equal(plan.risks.length, 0);
  assert.equal(plan.summary.coveragePercent, 100);
  assert.equal(plan.summary.extraHoursPerDayNeeded, 0);
});

test('buildPlan plans exactly the blocks each topic needs when time allows', () => {
  const topics = [topic({ name: 'A' }), topic({ name: 'B', difficulty: 4, confidence: 2 })];
  const plan = E.buildPlan(topics, { hoursPerDay: 6 });
  const planned = {};
  plan.days.forEach((d) => d.sessions.forEach((s) => (planned[s.topic] = (planned[s.topic] || 0) + s.blocks)));
  topics.forEach((t) => assert.equal(planned[t.name], E.blocksNeeded(t)));
});

test('buildPlan is deterministic and does not mutate its input', () => {
  const topics = [topic({ name: 'A' }), topic({ name: 'B', difficulty: 5 })];
  const snapshot = JSON.stringify(topics);
  const first = E.buildPlan(topics, { hoursPerDay: 3 });
  const second = E.buildPlan(topics, { hoursPerDay: 3 });
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(topics), snapshot);
});

test('buildPlan gives every session a plain-language reason', () => {
  const plan = E.buildPlan([topic({ name: 'A', confidence: 1, importance: 5 })], { hoursPerDay: 3 });
  const reason = plan.days[0].sessions[0].reason;
  assert.match(reason, /low confidence/);
  assert.match(reason, /high exam weight/);
});

test('nextAction picks the hardest topic when energy is high', () => {
  const plan = E.buildPlan(
    [topic({ name: 'Easy', difficulty: 1, confidence: 2 }), topic({ name: 'Hard', difficulty: 5, confidence: 2 })],
    { hoursPerDay: 4 }
  );
  assert.equal(E.nextAction(plan, 'high').topic, 'Hard');
});

test('nextAction picks the easiest topic with a shorter session when energy is low', () => {
  const plan = E.buildPlan(
    [topic({ name: 'Easy', difficulty: 1, confidence: 2 }), topic({ name: 'Hard', difficulty: 5, confidence: 2 })],
    { hoursPerDay: 4 }
  );
  const action = E.nextAction(plan, 'low');
  assert.equal(action.topic, 'Easy');
  assert.equal(action.focusMinutes, 25);
});

test('nextAction forces an exam-tomorrow topic regardless of energy', () => {
  const plan = E.buildPlan(
    [topic({ name: 'Tomorrow', daysLeft: 1, difficulty: 5, confidence: 2 }), topic({ name: 'Chill', difficulty: 1, confidence: 4 })],
    { hoursPerDay: 4 }
  );
  assert.equal(E.nextAction(plan, 'low').topic, 'Tomorrow');
});

test('nextAction handles an empty day without crashing', () => {
  const action = E.nextAction({ days: [] }, 'medium');
  assert.equal(action.topic, null);
  assert.ok(action.message.length > 0);
});

test('nextAction falls back to medium for unknown energy values', () => {
  const plan = E.buildPlan([topic({ name: 'A' })], { hoursPerDay: 2 });
  assert.equal(E.nextAction(plan, 'bogus').focusMinutes, 40);
});

test('applyProgress reduces remaining work and never exceeds what is needed', () => {
  const t = topic({ name: 'A', difficulty: 5, confidence: 1 });
  const [after] = E.applyProgress([t], { A: 2 });
  assert.equal(after.doneBlocks, 2);
  assert.equal(E.blocksRemaining(after), E.blocksNeeded(t) - 2);
  const [capped] = E.applyProgress([t], { A: 99 });
  assert.equal(capped.doneBlocks, E.blocksNeeded(t));
  assert.equal(t.doneBlocks, 0, 'input must not be mutated');
});

test('replanning after progress schedules less work', () => {
  const t = topic({ name: 'A', difficulty: 5, confidence: 1, daysLeft: 5 });
  const before = E.buildPlan([t], { hoursPerDay: 4 });
  const after = E.buildPlan(E.applyProgress([t], { A: 3 }), { hoursPerDay: 4 });
  const sum = (p) => p.days.reduce((n, d) => n + d.totalMinutes, 0);
  assert.ok(sum(after) < sum(before));
});

test('advanceDay moves exams closer and drops finished topics', () => {
  const result = E.advanceDay([topic({ name: 'A', daysLeft: 3 }), topic({ name: 'B', daysLeft: 1 })]);
  assert.equal(result.length, 1);
  assert.equal(result[0].name, 'A');
  assert.equal(result[0].daysLeft, 2);
});

test('buildPlan schedules a last-chance exam even when stronger topics compete for time', () => {
  const plan = E.buildPlan(
    [
      topic({ name: 'Big', daysLeft: 10, difficulty: 5, confidence: 1, importance: 5 }),
      topic({ name: 'Huge', daysLeft: 10, difficulty: 5, confidence: 1, importance: 5 }),
      topic({ name: 'Tomorrow', daysLeft: 1, difficulty: 1, confidence: 4, importance: 1 }),
    ],
    { hoursPerDay: 2 }
  );
  const todays = plan.days[0].sessions.map((s) => s.topic);
  assert.ok(todays.includes('Tomorrow'), 'exam-tomorrow topic was starved: ' + todays.join(', '));
  assert.equal(plan.risks.filter((r) => r.topic === 'Tomorrow').length, 0);
});

test('buildPlan only reports a risk when a topic truly cannot be finished', () => {
  const plan = E.buildPlan(
    [topic({ name: 'A', daysLeft: 3, difficulty: 4, confidence: 2 }), topic({ name: 'B', daysLeft: 3, difficulty: 4, confidence: 2 })],
    { hoursPerDay: 4 }
  );
  assert.equal(plan.risks.length, 0);
});
