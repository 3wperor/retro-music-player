const test = require('node:test');
const assert = require('node:assert');
const { parse } = require('../src/ytm/parse.js');

const fixture = (name) => require(`../fixtures/${name}.json`);
const all = (result) => result.sections.flatMap((section) => section.items);

test('search: top result, songs, artists, playlists and filter chips', () => {
  const result = parse(fixture('search'));
  assert.equal(result.sections[0].title, 'Top result');
  assert.equal(result.sections[0].items[0].kind, 'artist');
  const items = all(result);
  const song = items.find((item) => item.kind === 'song');
  assert.match(song.videoId, /^[\w-]{11}$/);
  assert.ok(song.title && song.subtitle && song.thumb.startsWith('https://'));
  assert.ok(items.some((item) => item.kind === 'playlist' && item.browseId.startsWith('VL')));
  assert.ok(result.chips.length > 2 && result.chips.every((chip) => chip.label && chip.params));
});

test('artist page: header with a play target and titled shelves', () => {
  const result = parse(fixture('artist'));
  assert.equal(result.header.title, 'Daft Punk');
  assert.ok(result.header.playPlaylistId);
  assert.ok(result.sections.length >= 2 && result.sections.every((section) => section.title));
  const video = all(result).find((item) => item.kind === 'song');
  assert.ok(video.videoId);
});

test('home: carousel shelves keep their titles and playable playlists', () => {
  const result = parse(fixture('home'));
  assert.ok(result.sections[0].title);
  assert.ok(result.sections[0].items.every((item) => item.kind !== 'text'));
});

test('junk input does not throw', () => {
  assert.deepEqual(parse(null).sections, []);
  assert.deepEqual(parse({ contents: { musicShelfRenderer: {} } }).sections, []);
});
