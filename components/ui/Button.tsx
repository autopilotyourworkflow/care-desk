"use client";

import Link from "next/link";
import { forwardRef, type ButtonHTMLAttributes, type ComponentType, type ReactNode, type SVGProps } from "react";
import { LoaderCircle } from "lucide-react";
import { cn } from "./cn";
import { Tooltip } from "./Tooltip";

export type IconType = ComponentType<SVGProps<SVGSVGElement> & { size?: number | string; strokeWidth?: number | string }>;

export type ButtonVariant =
  | "primary" // solid brand navy: the one main action in a region
  | "secondary" // white with a line: the alternative action
  | "subtle" // input-fill blue grey: toolbar and low-emphasis actions
  | "ghost" // text only: tertiary actions, menus
  | "destructive" // deep red: removing or discarding
  | "onNavy" // white on the navy field (welcome screen)
  | "onNavyGhost"; // outline on the navy field

export type ButtonSize = "sm" | "md" | "lg";

const base =
  "relative inline-flex shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap font-medium " +
  "transition-[background-color,border-color,color,box-shadow,transform] duration-150 ease-out-expo " +
  "active:scale-[0.98] disabled:active:scale-100 aria-disabled:active:scale-100 " +
  "disabled:cursor-not-allowed aria-disabled:cursor-not-allowed";

const variants: Record<ButtonVariant, string> = {
  primary:
    "bg-navy-900 text-white shadow-[0_1px_2px_rgb(1_3_55/0.18)] hover:bg-navy-700 active:bg-navy-950 " +
    "disabled:bg-disabled-bg disabled:text-disabled-fg disabled:shadow-none",
  secondary:
    "border border-line-strong bg-surface text-heading hover:border-navy-300 hover:bg-field active:bg-field-hover " +
    "disabled:border-transparent disabled:bg-disabled-bg disabled:text-disabled-fg",
  subtle: "bg-field text-heading hover:bg-field-hover active:bg-navy-100 disabled:bg-disabled-bg disabled:text-disabled-fg",
  ghost: "text-heading hover:bg-navy-900/[0.06] active:bg-navy-900/10 disabled:bg-transparent disabled:text-disabled-fg",
  destructive:
    "bg-urgent-solid text-white hover:bg-urgent-fg active:bg-[#7f0d14] disabled:bg-disabled-bg disabled:text-disabled-fg",
  onNavy: "bg-white text-navy-900 hover:bg-navy-50 active:bg-navy-100 disabled:bg-white/40 disabled:text-navy-700",
  onNavyGhost:
    "border border-white/30 text-white hover:border-white/60 hover:bg-white/10 active:bg-white/15 disabled:text-white/50",
};

const sizes: Record<ButtonSize, string> = {
  sm: "h-8 rounded-inner px-3 text-xs",
  md: "h-10 rounded-control px-4 text-sm",
  lg: "h-12 rounded-control px-6 text-base",
};

const iconSize: Record<ButtonSize, number> = { sm: 14, md: 16, lg: 18 };

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner in place of the leading icon, keeps the width, and blocks clicks. */
  loading?: boolean;
  /** Text read to screen readers while loading, e.g. "Sending". Defaults to the label. */
  loadingLabel?: string;
  leadingIcon?: IconType;
  trailingIcon?: IconType;
  /** Keyboard hint shown at the right edge, e.g. <Kbd>E</Kbd>. Hidden on small screens. */
  shortcut?: ReactNode;
  /** Render as a Next.js link instead of a button. */
  href?: string;
  fullWidth?: boolean;
  children?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "primary",
    size = "md",
    loading = false,
    loadingLabel,
    leadingIcon: Leading,
    trailingIcon: Trailing,
    shortcut,
    href,
    fullWidth,
    className,
    children,
    disabled,
    type = "button",
    onClick,
    ...rest
  },
  ref,
) {
  const s = iconSize[size];
  const classes = cn(base, variants[variant], sizes[size], fullWidth && "w-full", loading && "cursor-progress", className);
  const inner = (
    <>
      {loading ? (
        <LoaderCircle aria-hidden size={s} className="animate-spin" />
      ) : Leading ? (
        <Leading aria-hidden size={s} />
      ) : null}
      {children != null && <span className="truncate">{children}</span>}
      {Trailing && !loading && <Trailing aria-hidden size={s} />}
      {shortcut && <span className="ml-1 hidden items-center gap-0.5 opacity-80 lg:inline-flex">{shortcut}</span>}
      {loading && <span className="sr-only">{loadingLabel ?? "Working"}</span>}
    </>
  );

  if (href) {
    return (
      <Link href={href} className={classes} aria-label={rest["aria-label"]}>
        {inner}
      </Link>
    );
  }

  return (
    <button
      ref={ref}
      type={type}
      className={classes}
      disabled={disabled}
      aria-busy={loading || undefined}
      aria-disabled={loading || undefined}
      onClick={loading ? (e) => e.preventDefault() : onClick}
      {...rest}
    >
      {inner}
    </button>
  );
});

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  icon: IconType;
  /** Accessible name, also shown as a tooltip unless tooltip is false. */
  label: string;
  variant?: Exclude<ButtonVariant, "destructive">;
  size?: ButtonSize;
  loading?: boolean;
  tooltip?: boolean;
  /** Visual selected state for toggle buttons (sets aria-pressed). */
  pressed?: boolean;
}

const iconBtnSizes: Record<ButtonSize, string> = {
  sm: "size-8 rounded-inner",
  md: "size-10 rounded-control",
  lg: "size-12 rounded-control",
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon: Icon, label, variant = "ghost", size = "md", loading, tooltip = true, pressed, className, type = "button", onClick, ...rest },
  ref,
) {
  const btn = (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      aria-pressed={pressed}
      aria-busy={loading || undefined}
      onClick={loading ? (e) => e.preventDefault() : onClick}
      className={cn(
        base,
        variants[variant],
        iconBtnSizes[size],
        "px-0",
        pressed && "bg-selected-bg text-navy-900 ring-1 ring-navy-900/20",
        className,
      )}
      {...rest}
    >
      {loading ? (
        <LoaderCircle aria-hidden size={iconSize[size] + 2} className="animate-spin" />
      ) : (
        <Icon aria-hidden size={iconSize[size] + 2} />
      )}
    </button>
  );
  return tooltip ? (
    <Tooltip content={label} describe={false}>
      {btn}
    </Tooltip>
  ) : (
    btn
  );
});
