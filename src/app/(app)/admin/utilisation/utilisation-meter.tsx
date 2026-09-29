import { formatHours, utilisationPercent } from '@/lib/format';

interface Props {
  bookedMinutes: number;
  availableMinutes: number;
  // Accessible name + hover text, e.g. "Alpha, week of Sep 21".
  label: string;
}

// A single ratio against a limit, so a meter rather than a chart: the fill
// and the track are two steps of the same blue ramp. The fill is capped at
// the track's width, but the printed percentage isn't — booked time outside
// the bookable window can push a week past 100% (see README's "Documented
// decisions").
export function UtilisationMeter({
  bookedMinutes,
  availableMinutes,
  label,
}: Props) {
  const percent = utilisationPercent(bookedMinutes, availableMinutes);
  const description = `${label}: ${formatHours(bookedMinutes)} of ${formatHours(
    availableMinutes,
  )} h booked (${percent}%)`;

  return (
    <div className="flex items-center gap-2" title={description}>
      <div
        role="meter"
        aria-label={description}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.min(percent, 100)}
        className="h-2 w-24 overflow-hidden rounded bg-[#cde2fb] dark:bg-[#184f95]"
      >
        <div
          className="h-full rounded bg-[#2a78d6] dark:bg-[#6da7ec]"
          style={{ width: `${Math.min(percent, 100)}%` }}
        />
      </div>
      <span className="w-10 text-right text-xs text-gray-500 tabular-nums dark:text-gray-400">
        {percent}%
      </span>
    </div>
  );
}
