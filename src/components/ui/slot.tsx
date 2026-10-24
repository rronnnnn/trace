import { cloneElement, isValidElement } from "react";
import { cn } from "@/lib/utils";

/** Minimal asChild support: merges className and props onto the single child element. */
export function Slot({ children, className, ...props }: React.HTMLAttributes<HTMLElement> & { children?: React.ReactNode }) {
  if (!isValidElement<React.HTMLAttributes<HTMLElement>>(children)) return null;
  return cloneElement(children, { ...props, ...children.props, className: cn(className, children.props.className) });
}
