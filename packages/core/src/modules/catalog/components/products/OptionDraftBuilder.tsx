import React from "react";
import { Input } from "@open-mercato/ui/primitives/input";
import { Button } from "@open-mercato/ui/primitives/button";
import { Label } from "@open-mercato/ui/primitives/label";
import { TagsInput } from "@open-mercato/ui/backend/inputs/TagsInput";
import { Trash2, Plus } from "lucide-react";
import { ProductOptionInput } from "./productForm";


export interface OptionDraftBuilderProps {
  options: ProductOptionInput[];
  onChange: (options: ProductOptionInput[]) => void;
  t: (key: string, fallback: string) => string;
}

export function OptionDraftBuilder({ options, onChange, t }: OptionDraftBuilderProps) {
  const addOption = React.useCallback(() => {
    onChange([
      ...options,
      {
        id: crypto.randomUUID(),
        title: "",
        values: [],
      },
    ]);
  }, [options, onChange]);

  const removeOption = React.useCallback(
    (id: string) => {
      onChange(options.filter((o) => o.id !== id));
    },
    [options, onChange]
  );

  const handleOptionTitleChange = React.useCallback(
    (id: string, newTitle: string) => {
      onChange(
        options.map((option) => {
          if (option.id !== id) return option;
          return {
            ...option,
            title: newTitle,
          };
        })
      );
    },
    [options, onChange]
  );

  const setOptionValues = React.useCallback(
    (id: string, labels: string[]) => {
      onChange(
        options.map((option) => {
          if (option.id !== id) return option;
          const nextValues = labels.map((label: string) => {
            const existing = option.values.find((v: {id: string; label: string}) => v.label === label);
            return existing || { id: crypto.randomUUID(), label };
          });
          return { ...option, values: nextValues };
        })
      );
    },
    [options, onChange]
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">
          {t(
            "catalog.products.create.optionsBuilder.title",
            "Product options"
          )}
        </h3>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={addOption}
        >
          <Plus className="mr-2 h-4 w-4" />
          {t("catalog.products.create.optionsBuilder.add", "Add option")}
        </Button>
      </div>
      
      {options.map((option) => (
        <div key={option.id} className="rounded-md bg-muted/50 p-4 border">
          <div className="flex items-center gap-2">
            <Input
              value={option.title}
              onChange={(event) =>
                handleOptionTitleChange(option.id, event.target.value)
              }
              placeholder={t(
                "catalog.products.create.optionsBuilder.placeholder",
                "e.g., Color"
              )}
              className="flex-1"
            />
            <Button
              variant="ghost"
              size="icon"
              type="button"
              onClick={() => removeOption(option.id)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
          <div className="mt-3 space-y-2">
            <Label className="text-xs uppercase text-muted-foreground">
              {t("catalog.products.create.optionsBuilder.values", "Values")}
            </Label>
            <TagsInput
              value={option.values.map((value) => value.label)}
              onChange={(labels) => setOptionValues(option.id, labels)}
              placeholder={t(
                "catalog.products.create.optionsBuilder.valuePlaceholder",
                "Type a value and press Enter"
              )}
            />
          </div>
        </div>
      ))}
      
      {!options.length ? (
        <p className="text-sm text-muted-foreground bg-muted p-4 rounded-md text-center">
          {t(
            "catalog.products.create.optionsBuilder.empty",
            "No options yet. Add your first option to generate variants."
          )}
        </p>
      ) : null}
    </div>
  );
}
