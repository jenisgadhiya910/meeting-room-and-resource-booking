import { z } from 'zod';

// A year of weekly rows per room is the most the admin view needs; this caps
// the response size (rooms × weeks) instead of paginating it.
const MAX_RANGE_DAYS = 366;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Calendar dates, not instants: the report is whole weeks, so `from` and `to`
// only say which weeks to include — every week (in the bookable window's
// zone) that contains at least one day of [from, to], both inclusive. See
// README's "Documented decisions".
export const utilisationQuerySchema = z
  .object({
    roomId: z.uuid().optional(),
    from: z.iso.date(),
    to: z.iso.date(),
  })
  // Safe as a string comparison: both are zero-padded YYYY-MM-DD.
  .refine((v) => v.to >= v.from, {
    message: 'to must be on or after from',
    path: ['to'],
  })
  .refine(
    (v) =>
      (Date.parse(v.to) - Date.parse(v.from)) / MS_PER_DAY <= MAX_RANGE_DAYS,
    {
      message: `The range can span at most ${MAX_RANGE_DAYS} days`,
      path: ['to'],
    },
  );

export type UtilisationQuery = z.infer<typeof utilisationQuerySchema>;
