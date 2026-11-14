import test from 'node:test';
import assert from 'node:assert/strict';
import { mixedContentHint } from '../../lib/https.js';

test('mixedContentHint explains a picture served over HTTP on an HTTPS page', () => {
  const hint = mixedContentHint('http://pictures.example/a.jpg', 'https://site.example/gallery/');
  assert.match(hint, /^ This page is served over HTTPS but the picture is not/);
});

test('mixedContentHint has nothing to add in the other cases', () => {
  for (const [src, page] of [
    ['https://pictures.example/a.jpg', 'https://site.example/'],
    ['a.jpg', 'https://site.example/gallery/'],
    ['/pictures/a.jpg', 'https://site.example/gallery/'],
    ['//pictures.example/a.jpg', 'https://site.example/'],
    ['http://pictures.example/a.jpg', 'http://site.example/'],
    ['https://pictures.example/a.jpg', 'http://site.example/'],
    ['data:image/jpeg;base64,AA', 'https://site.example/'],
    ['blob:https://site.example/1234', 'https://site.example/'],
    ['', 'https://site.example/'],
    ['http://pictures.example/a.jpg', 'not a url'],
  ]) {
    assert.equal(mixedContentHint(src, page), '', `${src} on ${page}`);
  }
});
