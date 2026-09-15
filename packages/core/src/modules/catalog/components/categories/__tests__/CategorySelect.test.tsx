/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { CategorySelect } from '../CategorySelect'

if (typeof window !== 'undefined') {
  if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false
  if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => undefined
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => undefined
}

const mockReadApiResultOrThrow = jest.fn()
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  readApiResultOrThrow: (...args: unknown[]) => mockReadApiResultOrThrow(...args),
}))
jest.mock('@open-mercato/shared/lib/i18n/context', () => {
  const translate = (key: string, fallback?: string, vars?: Record<string, unknown>) => {
    const base = (fallback ?? key) as string
    if (vars) return base.replace(/\{\{(\w+)\}\}/g, (_, token) => String(vars[token] ?? ''))
    return base
  }
  return { useT: () => translate }
})
jest.mock('@open-mercato/ui/primitives/select', () => {
  const React2 = require('react') as typeof import('react')
  type SelectContextValue = {
    value?: string
    onValueChange?: (value: string) => void
    disabled?: boolean
    required?: boolean
    labels: Record<string, string>
    register: (value: string, label: string) => void
  }
  const SelectContext = React2.createContext<SelectContextValue>({
    labels: {},
    register: () => undefined,
  })
  return {
    Select: ({ children, value, onValueChange, disabled, required, name }: {
      children: React.ReactNode
      value?: string
      onValueChange?: (value: string) => void
      disabled?: boolean
      required?: boolean
      name?: string
    }) => {
      const [labels, setLabels] = React2.useState<Record<string, string>>({})
      const register = React2.useCallback((nextValue: string, label: string) => {
        setLabels((current) => current[nextValue] === label ? current : { ...current, [nextValue]: label })
      }, [])
      return (
        <SelectContext.Provider value={{ value, onValueChange, disabled, required, labels, register }}>
          <div data-name={name}>{children}</div>
        </SelectContext.Provider>
      )
    },
    SelectTrigger: React2.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement>>(
      ({ children, ...props }, ref) => {
        const context = React2.useContext(SelectContext)
        return (
          <button
            ref={ref}
            type="button"
            role="combobox"
            disabled={context.disabled}
            aria-required={context.required || undefined}
            {...props}
          >
            {children}
          </button>
        )
      },
    ),
    SelectValue: ({ children, placeholder }: { children?: React.ReactNode; placeholder?: string }) => {
      const context = React2.useContext(SelectContext)
      const selectedLabel = context.value ? context.labels[context.value] : undefined
      return <span>{children ?? selectedLabel ?? placeholder}</span>
    },
    SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    SelectItem: ({ children, value, disabled }: {
      children: React.ReactNode
      value: string
      disabled?: boolean
    }) => {
      const context = React2.useContext(SelectContext)
      const label = typeof children === 'string' ? children : ''
      React2.useEffect(() => {
        context.register(value, label)
      }, [context.register, label, value])
      return (
        <button type="button" role="option" disabled={disabled} onClick={() => context.onValueChange?.(value)}>
          {children}
        </button>
      )
    },
  }
})

const sampleNodes = [
  { id: 'cat-1', name: 'Electronics', isActive: true },
  { id: 'cat-2', name: 'Books', isActive: true },
  { id: 'cat-3', name: 'Archived', isActive: false },
]

function openSelect() {
  fireEvent.pointerDown(screen.getByRole('combobox'), { button: 0, ctrlKey: false, pointerType: 'mouse' })
}

describe('CategorySelect', () => {
  beforeEach(() => {
    mockReadApiResultOrThrow.mockReset()
  })

  it('renders provided nodes as options', () => {
    render(<CategorySelect nodes={sampleNodes} fetchOnMount={false} />)
    const select = screen.getByRole('combobox')
    expect(select).toBeInTheDocument()
    openSelect()
    expect(screen.getByText('Electronics')).toBeInTheDocument()
    expect(screen.getByText('Books')).toBeInTheDocument()
  })

  it('renders empty option by default with custom label', () => {
    render(
      <CategorySelect
        nodes={sampleNodes}
        fetchOnMount={false}
        emptyOptionLabel="-- Pick a category --"
      />,
    )
    expect(screen.getByRole('option', { name: '-- Pick a category --' })).toBeInTheDocument()
  })

  it('omits the empty option when includeEmptyOption is false', () => {
    render(
      <CategorySelect
        nodes={sampleNodes}
        fetchOnMount={false}
        includeEmptyOption={false}
      />,
    )
    openSelect()
    expect(screen.queryByRole('option', { name: 'Root level' })).not.toBeInTheDocument()
  })

  it('fires onChange with selected value', () => {
    const handleChange = jest.fn()
    render(
      <CategorySelect nodes={sampleNodes} fetchOnMount={false} onChange={handleChange} />,
    )
    openSelect()
    fireEvent.click(screen.getByRole('option', { name: 'Books' }))
    expect(handleChange).toHaveBeenCalledWith('cat-2')
  })

  it('fires onChange with null when empty option is selected', () => {
    const handleChange = jest.fn()
    render(
      <CategorySelect
        nodes={sampleNodes}
        fetchOnMount={false}
        onChange={handleChange}
        value="cat-1"
      />,
    )
    openSelect()
    fireEvent.click(screen.getByRole('option', { name: 'Root level' }))
    expect(handleChange).toHaveBeenCalledWith(null)
  })

  it('fetches categories on mount when fetchOnMount is true', async () => {
    mockReadApiResultOrThrow.mockResolvedValue({ items: sampleNodes })
    render(<CategorySelect fetchOnMount={true} />)
    await waitFor(() => {
      expect(screen.getByRole('combobox')).not.toBeDisabled()
    })
    openSelect()
    expect(screen.getByText('Electronics')).toBeInTheDocument()
    expect(mockReadApiResultOrThrow).toHaveBeenCalled()
  })

  it('shows the selected parent label after async options load', async () => {
    mockReadApiResultOrThrow.mockResolvedValue({ items: sampleNodes })
    render(<CategorySelect value="cat-2" fetchOnMount={true} />)
    await waitFor(() => {
      expect(screen.getByRole('combobox')).toHaveTextContent('Books')
    })
  })

  it('shows loading state during fetch', () => {
    mockReadApiResultOrThrow.mockReturnValue(new Promise(() => {}))
    render(<CategorySelect fetchOnMount={true} />)
    const select = screen.getByRole('combobox')
    expect(select).toBeDisabled()
  })

  it('shows error state on failed fetch', async () => {
    mockReadApiResultOrThrow.mockRejectedValue(new Error('Network error'))
    render(<CategorySelect fetchOnMount={true} />)
    await waitFor(() => {
      const select = screen.getByRole('combobox')
      expect(select).toHaveTextContent('Failed to load categories')
    })
  })

  it('disables the select when disabled prop is true', () => {
    render(<CategorySelect nodes={sampleNodes} fetchOnMount={false} disabled={true} />)
    const select = screen.getByRole('combobox')
    expect(select).toBeDisabled()
  })

  it('reflects the pre-selected value', () => {
    render(<CategorySelect nodes={sampleNodes} fetchOnMount={false} value="cat-2" />)
    expect(screen.getByRole('combobox')).toHaveTextContent('Books')
  })

  it('sets required attribute when required prop is true', () => {
    render(<CategorySelect nodes={sampleNodes} fetchOnMount={false} required={true} />)
    const select = screen.getByRole('combobox')
    expect(select).toBeRequired()
  })
})
