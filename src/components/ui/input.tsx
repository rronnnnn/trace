import { cn } from "@/lib/utils";

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-11 w-full rounded-md border border-line-strong bg-surface px-3 text-[16px] text-ink sm:text-[15px] placeholder:text-ink-3",
        "transition-colors focus:border-ink-2 focus:bg-white focus:outline-none focus-visible:outline-none",
        "aria-invalid:border-clay",
        className,
      )}
      {...props}
    />
  );
}

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("mb-1.5 block text-[13px] font-medium text-ink-2", className)} {...props} />;
}
