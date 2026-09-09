import { ChevronDown } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export interface NativeSelectOption {
  value: string;
  label: string;
}

interface NativeSelectProps {
  value: string;
  onValueChange: (value: string) => void;
  options: NativeSelectOption[];
  placeholder?: string;
  id?: string;
  ariaLabel?: string;
  className?: string;
  disabled?: boolean;
}

// "(pointer: coarse)" matches touch primary input (phones/tablets). It is the
// reliable signal to swap to the native <select> so the OS picker opens.
// Desktop with a mouse keeps the shadcn Select. Falls back to desktop when
// matchMedia is unavailable (jsdom/SSR).
const getTouch = () =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(pointer: coarse)").matches;

/** Swappable select: native <select> on touch devices (opens the OS picker),
 * shadcn Select on desktop. Same visual height/border so the UI stays even. */
export const NativeSelect = ({
  value,
  onValueChange,
  options,
  placeholder,
  id,
  ariaLabel,
  className,
  disabled,
}: NativeSelectProps) => {
  const [isTouch, setIsTouch] = useState(getTouch);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const mq = window.matchMedia("(pointer: coarse)");
    const handler = () => setIsTouch(mq.matches);
    mq.addEventListener?.("change", handler);
    return () => mq.removeEventListener?.("change", handler);
  }, []);

  // Desktop: shadcn Select (identical to before). The value "" is a real option
  // (e.g. the variants "—" placeholder), so a "" option is shown as-is.
  if (!isTouch) {
    return (
      <Select value={value} onValueChange={onValueChange} disabled={disabled}>
        <SelectTrigger
          id={id}
          aria-label={ariaLabel}
          className={cn("w-full", className)}
        >
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {placeholder && !options.some((o) => o.value === "") && (
            <SelectItem value="">{placeholder}</SelectItem>
          )}
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  // Touch: native <select> → opens the phone's picker.
  return (
    <div className={cn("relative w-full", className)}>
      <select
        id={id}
        aria-label={ariaLabel}
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        disabled={disabled}
        className="h-9 w-full appearance-none rounded-md border border-input bg-card px-3 py-2 text-sm whitespace-nowrap shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:bg-input/30 dark:ring-destructive/40"
      >
        {placeholder && !options.some((o) => o.value === "") && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground opacity-50" />
    </div>
  );
};