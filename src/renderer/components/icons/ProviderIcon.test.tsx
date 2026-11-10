/** @vitest-environment jsdom */
import { ModelProviderEnum } from '@shared/types'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import ProviderIcon from './ProviderIcon'

afterEach(cleanup)

describe('FastFlowLM provider icon', () => {
  it('uses the same opaque white-background asset in both themes', () => {
    const { container, rerender } = render(
      <div data-mantine-color-scheme="light">
        <ProviderIcon provider={ModelProviderEnum.FastFlowLM} size={32} className="fixture-icon" />
      </div>
    )
    const image = container.querySelector('img')
    expect(image?.getAttribute('src')).toContain('fastflowlm-white.png')
    expect(image?.getAttribute('width')).toBe('32')
    expect(image?.getAttribute('height')).toBe('32')
    expect(image?.className).toBe('fixture-icon')
    expect(container.querySelector('text')).toBeNull()
    const source = image?.getAttribute('src')

    rerender(
      <div data-mantine-color-scheme="dark">
        <ProviderIcon provider={ModelProviderEnum.FastFlowLM} />
      </div>
    )
    expect(container.querySelector('img')?.getAttribute('src')).toBe(source)
  })
})