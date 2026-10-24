import { Slot } from "./slot";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "quiet" | "danger";
type Size = "sm" | "md" | "lg" | "icon";

const variants: Record<Variant, string> = {
  primary: "bg-ink text-paper hover:bg-[#33312d] active:bg-black disabled:bg-ink-4",
  secondary: "bg-surface text-ink border border-line-strong hover:border-ink-3 hover:bg-white disabled:text-ink-4",
  ghost: "text-ink-2 hover:text-ink hover:bg-sunken disabled:text-ink-4",
  quiet: "text-ink-2 underline-offset-4 hover:text-ink hover:underline px-0! h-auto!",
  danger: "bg-clay text-white hover:bg-[#8e4733] disabled:opacity-50",
};

const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-[13px] gap-1.5",
  md: "h-10 px-4 text-sm gap-2",
  lg: "h-12 px-6 text-[15px] gap-2.5",
  icon: "size-9",
};

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  asChild?: boolean;
};

export function buttonClass({ variant = "primary", size = "md", className }: { variant?: Variant; size?: Size; className?: string } = {}) {
  return cn(
    "inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap rounded-md font-medium",
    "transition-[background-color,border-color,color,transform] duration-150 ease-out active:scale-[0.98]",
    "disabled:pointer-events-none",
    variants[variant],
    sizes[size],
    className,
  );
}

export function Button({ variant, size, asChild, className, type = "button", ...props }: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return <Comp type={asChild ? undefined : type} className={buttonClass({ variant, size, className })} {...props} />;
}
