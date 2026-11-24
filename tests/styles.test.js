const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

test('no styles that leave ghost frames in translucent windows', () => {
  for (const banned of [/backdrop-filter/, /will-change/, /translate3d|translateZ|perspective\(/, /mask-image/]) {
    assert.doesNotMatch(css, banned);
  }
  // filter is allowed only for the grayscale mode on thumbnails.
  const filters = css.match(/[^{}]*\{[^}]*(?<![-\w])filter:[^}]*\}/g) || [];
  assert.deepEqual(filters.map(rule => rule.split('{')[0].trim()), ['.crisp-visual-gallery.is-grayscale .crisp-visual-thumb img']);
});

test('the gallery never restyles Obsidian\'s own file sidebar', () => {
  assert.doesNotMatch(css, /\.workspace-split\.mod-left-split/);
  assert.doesNotMatch(css, /(^|[\s,])\.nav-files-container/);
});

test('select popups are not used, so Windows dark-mode popups cannot turn white', () => {
  const src = fs.readdirSync(path.join(__dirname, '..', 'src'), { recursive: true })
    .filter(f => f.endsWith('.js'))
    .map(f => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8')).join('\n');
  assert.doesNotMatch(src, /createEl\(\s*['"]select['"]/);
});
