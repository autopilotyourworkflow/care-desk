"use client";

import {
  createContext,
  forwardRef,
  useContext,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { ChevronDown, OctagonAlert } from "lucide-react";
import { cn } from "./cn";

interface FieldCtx {
  id: string;
  describedBy?: string;
  invalid: boolean;
  required?: boolean;
}

const FieldContext = createContext<FieldCtx | null>(null);

export interface FieldProps {
  label: ReactNode;
  /** Help text under the label, e.g. "Don't enter real personal details." */
  hint?: ReactNode;
  /** Error text: names the problem and the fix. Sets aria-invalid on the control and is read out politely when it appears. */
  error?: ReactNode;
  required?: boolean;
  /** Right-aligned text on the label row, e.g. a character count "120 / 1,000". */
  aside?: ReactNode;
  id?: string;
  className?: string;
  /** Visually hide the label (still read by screen readers). */
  hideLabel?: boolean;
  children: ReactNode;
}

/** Label, hint and error wired to the control inside it (TextInput, TextArea or Select). */
export function Field({ label, hint, error, required, aside, id, className, hideLabel, children }: FieldProps) {
  const auto = useId();
  const fid = id ?? auto;
  const hintId = hint ? `${fid}-hint` : undefined;
  const errId = error ? `${fid}-error` : undefined;
  const describedBy = [hintId, errId].filter(Boolean).join(" ") || undefined;
  return (
    <FieldContext.Provider value={{ id: fid, describedBy, invalid: Boolean(error), required }}>
      <div className={cn("flex flex-col gap-1.5", className)}>
        <div className={cn("flex items-baseline justify-between gap-3", hideLabel && "sr-only")}>
          <label htmlFor={fid} className="text-sm font-medium text-heading">
            {label}
            {required && (
              <span className="text-muted" aria-hidden>
                {" "}
                (required)
              </span>
            )}
          </label>
          {aside && <span className="text-xs text-muted tnum">{aside}</span>}
        </div>
        {hint && (
          <p id={hintId} className="-mt-0.5 text-xs text-muted">
            {hint}
          </p>
        )}
        {children}
        {/* Always mounted, so a new error is announced once when its text lands (a region inserted together with its
            text is often not read). Focus stays in the control. Empty, it cancels the column gap so nothing shifts. */}
        <div aria-live="polite" aria-atomic="true" className={cn(!error && "-mt-1.5")}>
          {error && (
            <p id={errId} className="flex items-start gap-1.5 text-xs font-medium text-error-fg">
              <OctagonAlert aria-hidden size={14} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </p>
          )}
        </div>
      </div>
    </FieldContext.Provider>
  );
}

function useField() {
  return useContext(FieldContext);
}

const control =
  "w-full rounded-control border bg-field px-4 text-sm text-ink placeholder:text-muted " +
  "transition-[background-color,border-color,box-shadow] duration-150 ease-out-expo " +
  "hover:bg-field-hover focus-visible:bg-surface focus-visible:outline-2 focus-visible:outline-focus " +
  "focus-visible:shadow-[0_0_0_4px_rgb(47_111_214/0.16)] " +
  "disabled:cursor-not-allowed disabled:border-line-strong disabled:bg-disabled-bg disabled:text-disabled-fg disabled:hover:bg-disabled-bg " +
  "read-only:bg-inset";

function stateClasses(invalid: boolean) {
  return invalid ? "border-error-fg bg-error-bg/40" : "border-control-line hover:border-muted-icon";
}

export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function TextInput(
  { className, id, ...rest },
  ref,
) {
  const f = useField();
  return (
    <input
      ref={ref}
      id={id ?? f?.id}
      aria-describedby={f?.describedBy}
      aria-invalid={f?.invalid || undefined}
      required={f?.required}
      className={cn(control, "h-11", stateClasses(Boolean(f?.invalid)), className)}
      {...rest}
    />
  );
});

export interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** Grow with content up to this many rows (CSS field-sizing where supported). */
  autoGrow?: boolean;
}

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea(
  { className, id, rows = 4, autoGrow, ...rest },
  ref,
) {
  const f = useField();
  return (
    <textarea
      ref={ref}
      id={id ?? f?.id}
      rows={rows}
      aria-describedby={f?.describedBy}
      aria-invalid={f?.invalid || undefined}
      required={f?.required}
      className={cn(
        control,
        "min-h-24 resize-y py-3 leading-relaxed",
        autoGrow && "[field-sizing:content] max-h-96",
        stateClasses(Boolean(f?.invalid)),
        className,
      )}
      {...rest}
    />
  );
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, id, children, ...rest },
  ref,
) {
  const f = useField();
  return (
    <span className="relative block">
      <select
        ref={ref}
        id={id ?? f?.id}
        aria-describedby={f?.describedBy}
        aria-invalid={f?.invalid || undefined}
        required={f?.required}
        className={cn(control, "h-11 appearance-none pr-10", stateClasses(Boolean(f?.invalid)), className)}
        {...rest}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden
        size={16}
        className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-muted-icon"
      />
    </span>
  );
});
