import assert from 'node:assert/strict'
import { test } from 'node:test'
import { clamp } from '../src/clamp.mjs'

test('clamp raises a value below the range to min', () => {
  assert.equal(clamp(-5, 0, 10), 0)
})

test('clamp keeps a value inside the range', () => {
  assert.equal(clamp(5, 0, 10), 5)
})

test('clamp lowers a value above the range to max', () => {
  assert.equal(clamp(15, 0, 10), 10)
})
