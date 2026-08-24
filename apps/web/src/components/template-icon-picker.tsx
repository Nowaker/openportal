import {
  Select,
  SelectContent,
  SelectItem,
  SelectLabel,
  SelectTrigger,
} from "@/components/ui/select";
import { TEMPLATE_ICONS, templateIconFor } from "@/lib/template-icons";

type TemplateIconPickerProps = {
  readonly value: string | undefined;
  readonly onChange: (iconId: string | null) => void;
};

export function TemplateIconPicker({
  value,
  onChange,
}: TemplateIconPickerProps) {
  const Current = templateIconFor(value);
  return (
    <Select
      selectedKey={value ?? "__default__"}
      onSelectionChange={(k) =>
        onChange(k === "__default__" ? null : String(k))
      }
      aria-label="Title-bar icon"
      className="w-36 shrink-0"
    >
      <SelectTrigger>
        <span className="inline-flex items-center gap-1.5">
          <Current className="size-4" />
          <span className="text-xs">Icon</span>
        </span>
      </SelectTrigger>
      <SelectContent>
        <SelectLabel>Title-bar icon</SelectLabel>
        <SelectItem id="__default__" textValue="Default">
          <span className="inline-flex items-center gap-2">
            {(() => {
              const D = templateIconFor(undefined);
              return <D className="size-4" />;
            })()}
            Default
          </span>
        </SelectItem>
        {TEMPLATE_ICONS.map((entry) => (
          <SelectItem key={entry.id} id={entry.id} textValue={entry.label}>
            <span className="inline-flex items-center gap-2">
              <entry.Icon className="size-4" />
              {entry.label}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
