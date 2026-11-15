import test from 'node:test';
import assert from 'node:assert/strict';
import { mixedContentHint, crossOriginHint, loadingHints } from '../../lib/https.js';

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

test('crossOriginHint explains what the server of another site must send', () => {
  for (const [src, page] of [
    ['https://pictures.example/a.jpg', 'https://site.example/gallery/'],
    ['//pictures.example/a.jpg', 'https://site.example/'],
    ['http://localhost:8643/a.jpg', 'http://localhost:8000/'],
    ['https://site.example:8443/a.jpg', 'https://site.example/'],
  ]) {
    const hint = crossOriginHint(src, page);
    assert.match(hint, /^ The picture comes from another site \(https?:\/\/[^)]+\)/, `${src} on ${page}`);
    assert.match(hint, /Access-Control-Allow-Origin/);
  }
});

test('crossOriginHint has nothing to add for a picture of the same site', () => {
  for (const [src, page] of [
    ['a.jpg', 'https://site.example/gallery/'],
    ['/pictures/a.jpg', 'https://site.example/gallery/'],
    ['https://site.example/a.jpg', 'https://site.example/gallery/'],
    ['data:image/jpeg;base64,AA', 'https://site.example/'],
    ['blob:https://site.example/1234', 'https://site.example/'],
    ['', 'https://site.example/'],
    ['https://pictures.example/a.jpg', 'not a url'],
  ]) {
    assert.equal(crossOriginHint(src, page), '', `${src} on ${page}`);
  }
});

test('loadingHints gives the reason that applies', () => {
  assert.match(loadingHints('http://pictures.example/a.jpg', 'https://site.example/'), /served over HTTPS but the picture is not/);
  assert.match(loadingHints('https://pictures.example/a.jpg', 'https://site.example/'), /another site/);
  assert.equal(loadingHints('a.jpg', 'https://site.example/'), '');
});
