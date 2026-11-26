import { ChevronDown } from 'lucide-react';
import type { FilterOption } from '../../types/overview';

interface SelectControlProps {
  id: string;
  label: string;
  value: string;
  options: FilterOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
}

export function SelectControl({
  id,
  label,
  value,
  options,
  onChange,
  disabled = false,
}: SelectControlProps) {
  return (
    <div className="flex flex-col gap-1">
      <label
        htmlFor={id}
        className="text-[11px] font-medium text-[#788C83] whitespace-nowrap"
      >
        {label}
      </label>
      <div className="relative">
        <select
          id={id}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-full appearance-none rounded-md border border-[#D9D7D0] bg-white pr-8 pl-3 text-[13px] font-medium text-[#202824] transition-colors duration-150 hover:border-[#788C83] focus:border-[#315F52] focus:outline-none disabled:cursor-not-allowed disabled:bg-[#FAF9F6] disabled:text-[#788C83]"
        >
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <ChevronDown
          className="pointer-events-none absolute top-1/2 right-2.5 h-3.5 w-3.5 -translate-y-1/2 text-[#788C83]"
          aria-hidden="true"
        />
      </div>
    </div>
  );
}
