'use client';

import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination';

import type { MouseEvent } from 'react';

interface Props {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

// shadcn's Pagination ships the primitives only — the "which page numbers
// to actually show" windowing is left to the consumer. This always keeps
// the first and last page, the current page and its immediate neighbours,
// and collapses everything else into a single ellipsis on each side.
function buildPageNumbers(
  current: number,
  total: number,
): (number | 'ellipsis')[] {
  const kept = new Set<number>([1, total, current - 1, current, current + 1]);
  const sorted = [...kept]
    .filter((page) => page >= 1 && page <= total)
    .sort((a, b) => a - b);

  const result: (number | 'ellipsis')[] = [];
  let previous = 0;
  for (const page of sorted) {
    if (previous && page - previous > 1) result.push('ellipsis');
    result.push(page);
    previous = page;
  }
  return result;
}

export function RoomPagination({ page, totalPages, onPageChange }: Props) {
  if (totalPages <= 1) return null;

  function linkClick(target: number) {
    return (event: MouseEvent<HTMLAnchorElement>) => {
      event.preventDefault();
      onPageChange(target);
    };
  }

  // `pointer-events-none` only stops mouse clicks — a keyboard Enter on a
  // focused "disabled" link still fires onClick, so Previous/Next check
  // the bound themselves rather than trusting the CSS.
  function boundedClick(target: number) {
    return (event: MouseEvent<HTMLAnchorElement>) => {
      event.preventDefault();
      if (target >= 1 && target <= totalPages) onPageChange(target);
    };
  }

  return (
    <Pagination>
      <PaginationContent>
        <PaginationItem>
          <PaginationPrevious
            href="#"
            aria-disabled={page <= 1}
            className={page <= 1 ? 'pointer-events-none opacity-50' : ''}
            onClick={boundedClick(page - 1)}
          />
        </PaginationItem>

        {buildPageNumbers(page, totalPages).map((entry, index) =>
          entry === 'ellipsis' ? (
            <PaginationItem key={`ellipsis-${index}`}>
              <PaginationEllipsis />
            </PaginationItem>
          ) : (
            <PaginationItem key={entry}>
              <PaginationLink
                href="#"
                isActive={entry === page}
                onClick={linkClick(entry)}
              >
                {entry}
              </PaginationLink>
            </PaginationItem>
          ),
        )}

        <PaginationItem>
          <PaginationNext
            href="#"
            aria-disabled={page >= totalPages}
            className={
              page >= totalPages ? 'pointer-events-none opacity-50' : ''
            }
            onClick={boundedClick(page + 1)}
          />
        </PaginationItem>
      </PaginationContent>
    </Pagination>
  );
}
