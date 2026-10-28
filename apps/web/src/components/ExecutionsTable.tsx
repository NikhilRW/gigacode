import { useNavigate } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import type { Execution } from '@engine/shared';
import { LANGUAGES } from '@shared/languages.ts';
import { StatusChip } from '@/components/StatusChip';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatMs, formatRelative, shortId } from '@/lib/format';

/** Runs as a table. Whole rows are clickable; the run ID is a real link so keyboards and screen readers work. */
export function ExecutionsTable({ items }: { items: Execution[] }) {
  const navigate = useNavigate();
  return (
    <div className="overflow-x-auto rounded-lg border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Status</TableHead>
            <TableHead>Run</TableHead>
            <TableHead>Language</TableHead>
            <TableHead>Started</TableHead>
            <TableHead className="text-right">Duration</TableHead>
            <TableHead className="w-8" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((e) => (
            <TableRow
              key={e.id}
              data-testid="run-row"
              className="cursor-pointer"
              onClick={() => navigate(`/executions/${e.id}`)}
            >
              <TableCell>
                <StatusChip status={e.status} />
              </TableCell>
              <TableCell>
                <a
                  href={`/executions/${e.id}`}
                  onClick={(ev) => {
                    ev.preventDefault();
                    ev.stopPropagation();
                    navigate(`/executions/${e.id}`);
                  }}
                  className="font-mono text-xs font-medium underline-offset-4 hover:underline"
                  aria-label={`Open run ${shortId(e.id)}`}
                >
                  {shortId(e.id)}
                </a>
              </TableCell>
              <TableCell className="text-sm">{LANGUAGES[e.language]?.label ?? e.language}</TableCell>
              <TableCell className="whitespace-nowrap text-sm text-muted-foreground" title={new Date(e.createdAt).toLocaleString()}>
                {formatRelative(e.createdAt)}
              </TableCell>
              <TableCell className="text-right font-mono text-xs tabular-nums">{formatMs(e.wallMs)}</TableCell>
              <TableCell>
                <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
