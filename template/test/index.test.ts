import { describe, expect, it } from 'vitest'
import { PROJECT_NAME } from '../src/index.js'

describe('{{repo}}', () => {
  it('exports its name', () => {
    expect(PROJECT_NAME).toBe('{{repo}}')
  })
})
