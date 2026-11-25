'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'src', 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');

function ids(source) {
  return Array.from(source.matchAll(/\sid="([^"]+)"/g)).map((m) => m[1]);
}

test('page declares a language, title, viewport and a skip link', () => {
  assert.match(html, /<html lang="en">/);
  assert.match(html, /<title>[^<]+<\/title>/);
  assert.match(html, /name="viewport"/);
  assert.match(html, /class="skip-link" href="#main"/);
  assert.match(html, /<main id="main"/);
});

test('element ids are unique', () => {
  const all = ids(html);
  assert.equal(new Set(all).size, all.length);
});

test('every text, number and select field has a matching label', () => {
  const fields = Array.from(html.matchAll(/<(?:input|select)\b[^>]*\sid="([^"]+)"[^>]*>/g));
  assert.ok(fields.length >= 6);
  fields.forEach((m) => {
    assert.match(html, new RegExp('<label[^>]*\\sfor="' + m[1] + '"'), 'no label for #' + m[1]);
  });
});

test('radio buttons are grouped in a fieldset with a legend', () => {
  assert.match(html, /<fieldset[^>]*>\s*<legend>/);
});

test('error and status regions are announced to assistive technology', () => {
  assert.match(html, /id="topic-errors"[^>]*role="alert"/);
  assert.match(html, /id="settings-errors"[^>]*role="alert"/);
  assert.match(html, /id="status"[^>]*role="status"/);
});

test('page ships a restrictive Content-Security-Policy', () => {
  assert.match(html, /http-equiv="Content-Security-Policy"/);
  assert.match(html, /default-src 'none'/);
  assert.doesNotMatch(html, /unsafe-inline|unsafe-eval/);
});

test('no inline scripts, inline event handlers or inline styles', () => {
  assert.doesNotMatch(html, /<script(?![^>]*\ssrc=)[^>]*>/);
  assert.doesNotMatch(html, /\son[a-z]+\s*=/i);
  assert.doesNotMatch(html, /\sstyle\s*=/i);
});

test('app code never uses unsafe DOM or code-execution APIs', () => {
  assert.doesNotMatch(app, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
  assert.doesNotMatch(app, /\beval\s*\(|new Function\s*\(/);
});

test('source contains no hard-coded secrets or remote calls', () => {
  [html, app, css].forEach((source) => {
    assert.doesNotMatch(source, /api[_-]?key|secret|password|bearer\s/i);
    assert.doesNotMatch(source, /\bfetch\s*\(|XMLHttpRequest|https?:\/\/(?!www\.w3\.org)/);
  });
});

test('every element id the UI code looks up exists in index.html', () => {
  const present = new Set(ids(html));
  const wanted = Array.from(app.matchAll(/(?:\$|getElementById)\(\s*'([^']+)'\s*\)/g)).map((m) => m[1]);
  assert.ok(wanted.length > 10);
  wanted.forEach((id) => assert.ok(present.has(id), 'missing #' + id));
});

test('stylesheet provides visible focus and respects reduced motion', () => {
  assert.match(css, /:focus-visible/);
  assert.match(css, /prefers-reduced-motion/);
});

test('interactive controls meet the 44px touch-target guideline', () => {
  assert.match(css, /min-height:\s*44px/);
});
