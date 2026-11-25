/**
 * StudyPilot - UI controller.
 *
 * Security notes:
 *   - All user text is rendered as plain text nodes, never parsed as markup.
 *   - All input passes through Validate before reaching the engine.
 *   - Saved data is re-validated on load, so tampered storage cannot break the app.
 */
(function () {
  'use strict';

  const Validate = window.Validate;
  const Engine = window.StudyEngine;
  const STORAGE_KEY = 'studypilot.v1';
  const COLOR_CLASSES = 8;

  const EXAMPLE_TOPICS = [
    { name: 'Data Structures', daysLeft: 6, difficulty: 4, confidence: 2, importance: 5 },
    { name: 'Discrete Mathematics', daysLeft: 4, difficulty: 3, confidence: 3, importance: 4 },
    { name: 'Operating Systems', daysLeft: 9, difficulty: 4, confidence: 2, importance: 4 },
    { name: 'English Communication', daysLeft: 2, difficulty: 1, confidence: 4, importance: 2 },
    { name: 'Python Lab', daysLeft: 11, difficulty: 2, confidence: 3, importance: 3 },
  ];

  const state = {
    context: { hoursPerDay: 3, energy: 'medium' },
    topics: [],
    plan: null,
    done: new Set(), // keys "day|topic" of sessions the student ticked
  };

  const $ = function (id) { return document.getElementById(id); };

  /** Create an element with optional class and text. Text is never parsed as HTML. */
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function formatMinutes(total) {
    const hours = Math.floor(total / 60);
    const minutes = total % 60;
    if (hours && minutes) return hours + ' h ' + minutes + ' min';
    if (hours) return hours + ' h';
    return minutes + ' min';
  }

  function announce(message) {
    $('status').textContent = message;
  }

  function showErrors(id, errors) {
    $(id).textContent = errors.join('\n');
  }

  /* ---------- persistence ---------- */

  function save() {
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ context: state.context, topics: state.topics, done: Array.from(state.done) })
      );
    } catch (err) {
      /* Storage may be disabled; the app still works without it. */
    }
  }

  function load() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw || raw.length > 20000) return;
      const data = JSON.parse(raw);
      const context = Validate.validateContext(data && data.context);
      if (context.ok) state.context = context.value;
      state.topics = Validate.cleanTopicList(data && data.topics);
      state.done = new Set(
        data && Array.isArray(data.done)
          ? data.done.filter(function (key) { return typeof key === 'string' && key.length <= 100; }).slice(0, 500)
          : []
      );
    } catch (err) {
      state.topics = [];
    }
  }

  /* ---------- settings ---------- */

  function syncSettingsToForm() {
    $('hours').value = String(state.context.hoursPerDay);
    const radio = document.querySelector('input[name="energy"][value="' + state.context.energy + '"]');
    if (radio) radio.checked = true;
  }

  function readSettings() {
    const checked = document.querySelector('input[name="energy"]:checked');
    return Validate.validateContext({
      hoursPerDay: $('hours').value,
      energy: checked ? checked.value : '',
    });
  }

  /* ---------- topic list ---------- */

  function renderTopics() {
    const list = $('topic-list');
    list.replaceChildren();
    $('empty-topics').hidden = state.topics.length > 0;

    state.topics.forEach(function (topic, index) {
      const item = el('li', 'c' + (index % COLOR_CLASSES));
      const info = el('div');
      info.appendChild(el('strong', '', topic.name));
      info.appendChild(
        el(
          'span',
          'topic-meta',
          'Exam in ' + topic.daysLeft + (topic.daysLeft === 1 ? ' day' : ' days') +
            ' | difficulty ' + topic.difficulty + ' | confidence ' + topic.confidence +
            ' | weight ' + topic.importance
        )
      );
      const remove = el('button', 'btn secondary', 'Remove');
      remove.type = 'button';
      remove.setAttribute('aria-label', 'Remove ' + topic.name);
      remove.addEventListener('click', function () { removeTopic(topic.name); });
      item.appendChild(info);
      item.appendChild(remove);
      list.appendChild(item);
    });
  }

  function removeTopic(name) {
    state.topics = state.topics.filter(function (t) { return t.name !== name; });
    resetPlan();
    renderTopics();
    save();
    announce('Removed ' + name + '. Build your plan again to update it.');
    $('topic-name').focus();
  }

  function resetPlan() {
    state.plan = null;
    state.done.clear();
    $('results').hidden = true;
  }

  function onAddTopic(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const result = Validate.addTopic(state.topics, {
      name: form.elements.name.value,
      daysLeft: form.elements.daysLeft.value,
      difficulty: form.elements.difficulty.value,
      confidence: form.elements.confidence.value,
      importance: form.elements.importance.value,
    });
    if (!result.ok) {
      showErrors('topic-errors', result.errors);
      return;
    }
    showErrors('topic-errors', []);
    state.topics = result.topics;
    form.elements.name.value = '';
    resetPlan();
    renderTopics();
    save();
    announce('Added ' + state.topics[state.topics.length - 1].name + '.');
    form.elements.name.focus();
  }

  /* ---------- plan ---------- */

  function dayLabel(offset) {
    if (offset === 0) return 'Today';
    if (offset === 1) return 'Tomorrow';
    const date = new Date();
    date.setDate(date.getDate() + offset);
    return date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  }

  function colorIndex(topicName) {
    const index = state.topics.findIndex(function (t) { return t.name === topicName; });
    return (index < 0 ? 0 : index) % COLOR_CLASSES;
  }

  function sessionKey(day, topic) {
    return day + '|' + topic;
  }

  function renderNowCard() {
    const action = Engine.nextAction(state.plan, state.context.energy);
    if (!action.topic) {
      $('now-topic').textContent = 'Nothing due today';
      $('now-detail').textContent = action.message;
      $('now-why').textContent = '';
      return;
    }
    $('now-topic').textContent = action.topic;
    $('now-detail').textContent =
      'Focus for ' + action.focusMinutes + ' minutes, then take a ' + action.breakMinutes +
      '-minute break. Today you have ' + formatMinutes(action.sessionMinutes) + ' planned on this topic.';
    $('now-why').textContent = action.message + ' (' + action.reason + ')';
  }

  function renderRisks() {
    const box = $('risks');
    const list = $('risk-list');
    list.replaceChildren();
    const risks = state.plan.risks;
    box.hidden = risks.length === 0;
    if (risks.length === 0) return;

    risks.forEach(function (risk) {
      list.appendChild(
        el('li', '', risk.topic + ': about ' + formatMinutes(risk.shortfallMinutes) + ' will not fit before its exam.')
      );
    });
    const extra = state.plan.summary.extraHoursPerDayNeeded;
    $('risk-advice').textContent =
      'Studying roughly ' + extra + ' more hour' + (extra === 1 ? '' : 's') +
      ' a day should help. Otherwise, protect your time for the topics at the top of each day.';
  }

  function renderSummary() {
    const s = state.plan.summary;
    $('summary').textContent =
      s.coveragePercent + '% of your needed study time (' + formatMinutes(s.totalMinutes) +
      ') is scheduled over ' + s.horizonDays + (s.horizonDays === 1 ? ' day.' : ' days.');
  }

  function updateProgress() {
    let total = 0;
    state.plan.days.forEach(function (d) { total += d.sessions.length; });
    $('progress').textContent = state.done.size + ' of ' + total + ' sessions marked done.';
  }

  function renderPlanDays() {
    const container = $('plan');
    container.replaceChildren();
    const capacity = Math.floor(state.context.hoursPerDay * 2);
    const fragment = document.createDocumentFragment();

    state.plan.days.forEach(function (day) {
      const section = el('section', 'day');
      const heading = 'day-heading-' + day.day;
      section.setAttribute('aria-labelledby', heading);

      const head = el('div', 'day-head');
      const h3 = el('h3', '', dayLabel(day.day));
      h3.id = heading;
      head.appendChild(h3);
      head.appendChild(el('span', 'day-total', formatMinutes(day.totalMinutes) + ' planned'));
      section.appendChild(head);

      const strip = el('div', 'strip');
      strip.setAttribute('aria-hidden', 'true');
      const cells = [];
      day.sessions.forEach(function (s) {
        for (let i = 0; i < s.blocks; i++) cells.push('cell filled c' + colorIndex(s.topic));
      });
      for (let i = 0; i < capacity; i++) strip.appendChild(el('span', cells[i] || 'cell'));
      section.appendChild(strip);

      if (day.sessions.length === 0) {
        section.appendChild(el('p', 'free', 'Free day. Nothing is needed here, so rest or review lightly.'));
      } else {
        const ul = el('ul', 'sessions');
        day.sessions.forEach(function (s) {
          const key = sessionKey(day.day, s.topic);
          const li = el('li', 'session');
          const label = el('label');
          const box = el('input');
          box.type = 'checkbox';
          box.checked = state.done.has(key);
          box.addEventListener('change', function () {
            if (box.checked) state.done.add(key);
            else state.done.delete(key);
            updateProgress();
            save();
            announce((box.checked ? 'Marked done: ' : 'Marked not done: ') + s.topic);
          });
          const swatch = el('span', 'swatch c' + colorIndex(s.topic));
          swatch.setAttribute('aria-hidden', 'true');
          const text = el('span', 'text');
          text.appendChild(el('span', 'name', s.topic));
          text.appendChild(document.createTextNode(' for ' + formatMinutes(s.minutes)));
          text.appendChild(el('span', 'why', 'Why: ' + s.reason));
          label.appendChild(box);
          label.appendChild(swatch);
          label.appendChild(text);
          li.appendChild(label);
          ul.appendChild(li);
        });
        section.appendChild(ul);
      }
      fragment.appendChild(section);
    });
    container.appendChild(fragment);
  }

  function renderResults() {
    renderNowCard();
    renderRisks();
    renderSummary();
    renderPlanDays();
    updateProgress();
    $('results').hidden = false;
  }

  function buildPlan(options) {
    const settings = readSettings();
    if (!settings.ok) {
      showErrors('settings-errors', settings.errors);
      return false;
    }
    showErrors('settings-errors', []);
    if (state.topics.length === 0) {
      announce('Add at least one topic first.');
      $('topic-name').focus();
      return false;
    }
    state.context = settings.value;
    state.plan = Engine.buildPlan(state.topics, state.context);
    const validKeys = new Set();
    state.plan.days.forEach(function (day) {
      day.sessions.forEach(function (session) {
        validKeys.add(sessionKey(day.day, session.topic));
      });
    });
    state.done = new Set(Array.from(state.done).filter(function (key) { return validKeys.has(key); }));
    save();
    renderResults();
    if (!options || options.focus !== false) $('results-heading').focus();
    return true;
  }

  /** Blocks completed per topic, taken from the ticked sessions. */
  function collectProgress() {
    const done = {};
    state.plan.days.forEach(function (day) {
      day.sessions.forEach(function (s) {
        if (state.done.has(sessionKey(day.day, s.topic))) {
          done[s.topic] = (done[s.topic] || 0) + s.blocks;
        }
      });
    });
    return done;
  }

  function onReplan() {
    if (!state.plan) return;
    state.topics = Engine.applyProgress(state.topics, collectProgress());
    state.done.clear();
    buildPlan({ focus: false });
    announce('Plan updated with your progress.');
  }

  function onNextDay() {
    if (!state.plan) return;
    state.topics = Engine.advanceDay(Engine.applyProgress(state.topics, collectProgress()));
    state.done.clear();
    renderTopics();
    if (state.topics.length === 0) {
      resetPlan();
      save();
      announce('All your exams are behind you. Well done.');
      return;
    }
    buildPlan({ focus: false });
    announce('New day started. Missed work has been spread over the days that remain.');
  }

  function onClear() {
    state.topics = [];
    resetPlan();
    renderTopics();
    save();
    announce('Cleared all topics.');
  }

  function onExample() {
    state.topics = Validate.cleanTopicList(EXAMPLE_TOPICS);
    resetPlan();
    renderTopics();
    save();
    announce('Loaded ' + state.topics.length + ' example topics. Choose Build my plan.');
  }

  function onSettingsChange() {
    const settings = readSettings();
    if (!settings.ok) {
      showErrors('settings-errors', settings.errors);
      return;
    }
    showErrors('settings-errors', []);
    state.context = settings.value;
    save();
    if (state.plan) buildPlan({ focus: false });
  }

  function init() {
    load();
    syncSettingsToForm();
    renderTopics();
    $('topic-form').addEventListener('submit', onAddTopic);
    $('settings-form').addEventListener('submit', function (e) { e.preventDefault(); });
    $('settings-form').addEventListener('change', onSettingsChange);
    $('build-btn').addEventListener('click', function () { buildPlan(); });
    $('replan-btn').addEventListener('click', onReplan);
    $('nextday-btn').addEventListener('click', onNextDay);
    $('clear-btn').addEventListener('click', onClear);
    $('example-btn').addEventListener('click', onExample);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
