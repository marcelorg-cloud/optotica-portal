import test from 'node:test';
import assert from 'node:assert/strict';
import { suggestGalleryColors } from '../lib/catalog/suggest-gallery-colors.ts';

test('suggests only the uniquely matching image source without replacing saved choices', () => {
  const colors = [
    { id: 'black', sourceImageUrl: 'https://ae01.alicdn.com/kf/S1234567890black.jpg_50x50.jpg' },
    { id: 'red', sourceImageUrl: 'https://ae01.alicdn.com/kf/S1234567890red.jpg_50x50.jpg' }
  ];
  const photos = [
    { id: 'same', url: 'https://ae02.alicdn.com/kf/S1234567890black.jpg_800x800.jpg?x=1', colorImageIds: [], colorTagsReviewed: false },
    { id: 'saved', url: 'https://ae02.alicdn.com/kf/S1234567890black.jpg', colorImageIds: ['red'], colorTagsReviewed: true },
    { id: 'rejected', url: 'https://ae02.alicdn.com/kf/S1234567890black.jpg', colorImageIds: [], colorTagsReviewed: true },
    { id: 'unknown', url: 'https://ae02.alicdn.com/kf/S1234567890other.jpg', colorImageIds: [], colorTagsReviewed: false }
  ];
  assert.deepEqual(suggestGalleryColors(photos, colors), { same: ['black'] });
});
