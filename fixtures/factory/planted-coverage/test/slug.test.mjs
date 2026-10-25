import assert from 'node:assert/strict'
import { test } from 'node:test'
import { MAX_SLUG_LENGTH, slugify } from '../src/index.mjs'

test('slugify strips accents and joins words with hyphens', () => {
  assert.equal(slugify('Árbol de Navidad!'), 'arbol-de-navidad')
})

test('slugify answers an empty slug for an empty title', () => {
  assert.equal(slugify(''), '')
})

test('slugify cuts the slug at MAX_SLUG_LENGTH', () => {
  assert.equal(slugify('a'.repeat(MAX_SLUG_LENGTH + 10)).length, MAX_SLUG_LENGTH)
})
