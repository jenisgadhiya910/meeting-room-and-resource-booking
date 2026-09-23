import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

import type { ClassValue } from 'clsx';

// The one piece every shadcn/ui component needs: merges conditional class
// names (clsx) and then resolves conflicting Tailwind utilities in favour
// of the last one (twMerge) — e.g. a caller-supplied `className` overriding
// a component's own default padding instead of both ending up in the DOM.
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
