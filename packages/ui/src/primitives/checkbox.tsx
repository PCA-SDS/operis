import * as React from "react"
import * as CheckboxPrimitive from "@radix-ui/react-checkbox"
import { Check, Minus } from "lucide-react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@open-mercato/shared/lib/utils"

/* Checked state is `--primary`, matching every other filled selection control
   (Radio, Switch). Reserve `--accent-strong` for things you can click THROUGH
   to somewhere else — links, tabs, sort indicators — so a screen of ticked
   boxes and a screen of links never blur into one another. */
const checkboxVariants = cva(
  "peer shrink-0 rounded-sm border border-input bg-input-bg transition-colors focus-visible:outline-none focus-visible:shadow-focus disabled:cursor-not-allowed disabled:border-border-disabled disabled:bg-bg-disabled disabled:opacity-100 disabled:text-text-disabled hover:border-primary/50 data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground data-[state=checked]:border-primary data-[state=indeterminate]:bg-primary data-[state=indeterminate]:text-primary-foreground data-[state=indeterminate]:border-primary",
  {
    variants: {
      size: {
        sm: "size-4",
        md: "size-5",
      },
    },
    defaultVariants: {
      size: "sm",
    },
  }
)

const indicatorIconBySize = {
  sm: "size-3.5",
  md: "size-4",
} as const

export type CheckboxProps = React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root> &
  VariantProps<typeof checkboxVariants>

const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  CheckboxProps
>(({ className, size, type = "button", ...props }, ref) => {
  const iconClass = indicatorIconBySize[size ?? "sm"]
  return (
    <CheckboxPrimitive.Root
      ref={ref}
      type={type}
      className={cn(checkboxVariants({ size, className }))}
      {...props}
    >
      <CheckboxPrimitive.Indicator className={cn("flex items-center justify-center text-current")}>
        {props.checked === "indeterminate" ? (
          <Minus className={iconClass} strokeWidth={3} aria-hidden="true" />
        ) : (
          <Check className={iconClass} strokeWidth={3} aria-hidden="true" />
        )}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
})
Checkbox.displayName = CheckboxPrimitive.Root.displayName

export { Checkbox, checkboxVariants }
