/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../select'

describe('Select primitive', () => {
  it('forwards viewport props to support scroll-driven loading', () => {
    const onScroll = jest.fn()
    render(
      <Select defaultOpen>
        <SelectTrigger>
          <SelectValue placeholder="Pick" />
        </SelectTrigger>
        <SelectContent viewportProps={{ 'data-testid': 'select-viewport', onScroll }}>
          <SelectItem value="a">A</SelectItem>
          <SelectItem value="b">B</SelectItem>
        </SelectContent>
      </Select>,
    )

    fireEvent.scroll(screen.getByTestId('select-viewport'))

    expect(onScroll).toHaveBeenCalledTimes(1)
  })
})
