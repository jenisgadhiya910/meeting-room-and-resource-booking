// Shared Tailwind class strings for the plain form controls used across the
// app — kept here once the same input/button styling started showing up in
// enough places (login, room search, admin) that copy-pasting it further
// would be the actual mistake.
export const inputClassName =
  'w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900';

export const primaryButtonClassName =
  'rounded-md bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black';

export const secondaryButtonClassName =
  'rounded-md border border-gray-300 px-3 py-1.5 text-sm disabled:opacity-50 dark:border-gray-700';

export const dangerButtonClassName =
  'rounded-md border border-red-300 px-3 py-1.5 text-sm text-red-600 disabled:opacity-50 dark:border-red-800 dark:text-red-400';
