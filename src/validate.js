/**
 * StudyPilot - input validation and sanitisation.
 *
 * Every value that enters the engine passes through this module.
 * Pure functions only: no DOM access, no side effects.
 * Works as a plain <script> (window.Validate) and as a Node module.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Validate = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const LIMITS = Object.freeze({
    maxTopics: 12,
    nameMaxLength: 40,
    daysLeft: { min: 1, max: 30 },
    rating: { min: 1, max: 5 },
    hoursPerDay: { min: 0.5, max: 12 },
    doneBlocks: { min: 0, max: 8 },
  });

  const ENERGY_LEVELS = Object.freeze(['low', 'medium', 'high']);

  /**
   * Clean a free-text topic name: normalise, strip control characters and
   * angle brackets, collapse whitespace, and cap the length.
   * @param {unknown} raw
   * @returns {string}
   */
  function sanitizeName(raw) {
    if (typeof raw !== 'string') return '';
    return raw
      .normalize('NFKC')
      .replace(/[\u0000-\u001F\u007F-\u009F]/g, '')
      .replace(/[<>]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, LIMITS.nameMaxLength);
  }

  /**
   * Parse a whole number inside [min, max]. Accepts numbers and numeric strings.
   * @returns {{ok: true, value: number} | {ok: false, error: string}}
   */
  function parseInteger(raw, min, max, label) {
    const text = typeof raw === 'string' ? raw.trim() : raw;
    if (text === '' || text === null || text === undefined || typeof text === 'boolean') {
      return { ok: false, error: label + ' is required.' };
    }
    const value = Number(text);
    if (!Number.isInteger(value)) {
      return { ok: false, error: label + ' must be a whole number.' };
    }
    if (value < min || value > max) {
      return { ok: false, error: label + ' must be between ' + min + ' and ' + max + '.' };
    }
    return { ok: true, value: value };
  }

  /**
   * Validate one topic. Returns a cleaned copy and never mutates the input.
   * @returns {{ok: boolean, errors: string[], value: object|null}}
   */
  function validateTopic(input) {
    const errors = [];
    if (input === null || typeof input !== 'object') {
      return { ok: false, errors: ['Topic data is missing.'], value: null };
    }

    const name = sanitizeName(input.name);
    if (!name) errors.push('Topic name is required.');

    const fields = [
      ['daysLeft', 'Days until the exam', LIMITS.daysLeft],
      ['difficulty', 'Difficulty', LIMITS.rating],
      ['confidence', 'Confidence', LIMITS.rating],
      ['importance', 'Exam weight', LIMITS.rating],
    ];
    const value = { name: name };
    fields.forEach(function (f) {
      const result = parseInteger(input[f[0]], f[2].min, f[2].max, f[1]);
      if (result.ok) value[f[0]] = result.value;
      else errors.push(result.error);
    });

    if (input.doneBlocks !== undefined) {
      const done = parseInteger(input.doneBlocks, LIMITS.doneBlocks.min, LIMITS.doneBlocks.max, 'Progress');
      if (done.ok) value.doneBlocks = done.value;
      else errors.push(done.error);
    } else {
      value.doneBlocks = 0;
    }

    return errors.length ? { ok: false, errors: errors, value: null } : { ok: true, errors: [], value: value };
  }

  /**
   * Validate study settings (hours per day, current energy).
   * @returns {{ok: boolean, errors: string[], value: object|null}}
   */
  function validateContext(input) {
    const errors = [];
    if (input === null || typeof input !== 'object') {
      return { ok: false, errors: ['Study settings are missing.'], value: null };
    }

    const hours = Number(typeof input.hoursPerDay === 'string' ? input.hoursPerDay.trim() : input.hoursPerDay);
    const { min, max } = LIMITS.hoursPerDay;
    const rawType = typeof input.hoursPerDay;
    if ((rawType !== 'number' && rawType !== 'string') || input.hoursPerDay === '' || Number.isNaN(hours)) {
      errors.push('Study hours per day is required.');
    } else if (hours < min || hours > max) {
      errors.push('Study hours per day must be between ' + min + ' and ' + max + '.');
    } else if (!Number.isInteger(hours * 2)) {
      errors.push('Study hours per day must be in steps of 0.5.');
    }

    const energy = typeof input.energy === 'string' ? input.energy.toLowerCase() : '';
    if (ENERGY_LEVELS.indexOf(energy) === -1) {
      errors.push('Energy must be low, medium or high.');
    }

    return errors.length
      ? { ok: false, errors: errors, value: null }
      : { ok: true, errors: [], value: { hoursPerDay: hours, energy: energy } };
  }

  /**
   * Validate a topic and add it to an existing list (returns a new list).
   * Rejects duplicates (case-insensitive) and enforces the topic cap.
   * @returns {{ok: boolean, errors: string[], topics: object[]}}
   */
  function addTopic(topics, input) {
    const list = Array.isArray(topics) ? topics : [];
    const result = validateTopic(input);
    if (!result.ok) return { ok: false, errors: result.errors, topics: list };

    if (list.length >= LIMITS.maxTopics) {
      return { ok: false, errors: ['You can plan up to ' + LIMITS.maxTopics + ' topics at a time.'], topics: list };
    }
    const lower = result.value.name.toLowerCase();
    if (list.some(function (t) { return t.name.toLowerCase() === lower; })) {
      return { ok: false, errors: ['"' + result.value.name + '" is already in your list.'], topics: list };
    }
    return { ok: true, errors: [], topics: list.concat([result.value]) };
  }

  /**
   * Re-validate a stored or imported list, dropping anything invalid.
   * @returns {object[]}
   */
  function cleanTopicList(rawList) {
    if (!Array.isArray(rawList)) return [];
    let topics = [];
    rawList.slice(0, LIMITS.maxTopics).forEach(function (item) {
      topics = addTopic(topics, item).topics;
    });
    return topics;
  }

  return {
    LIMITS: LIMITS,
    ENERGY_LEVELS: ENERGY_LEVELS,
    sanitizeName: sanitizeName,
    parseInteger: parseInteger,
    validateTopic: validateTopic,
    validateContext: validateContext,
    addTopic: addTopic,
    cleanTopicList: cleanTopicList,
  };
});
