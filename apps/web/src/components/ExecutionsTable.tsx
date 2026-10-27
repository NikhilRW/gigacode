import { useNavigate } from 'react-router-dom';
import type { Execution } from '@engine/shared';
import { LANGUAGES } from '@shared/languages.ts';
import { formatMs, formatTime, shortId } from '../lib/format.ts';
import { StatusChip } from './StatusChip.tsx';
import { Table, td } from './ui.tsx';

export function ExecutionsTable({ items }: { items: Execution[] }) {
  const navigate = useNavigate();
  if (items.length === 0) return <p className="text-sm text-slate-500">No executions yet.</p>;
  return (
    <Table head={['ID', 'Status', 'Language', 'Created', 'Wall', 'Exit']}>
      {items.map((e) => (
        <tr
          key={e.id}
          className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/60"
          onClick={() => navigate(`/executions/${e.id}`)}
        >
          <td className={td}>
            {/* Real link keeps rows keyboard accessible. */}
            <a
              href={`/executions/${e.id}`}
              onClick={(ev) => {
                ev.preventDefault();
                navigate(`/executions/${e.id}`);
              }}
              className="font-mono text-indigo-600 underline dark:text-indigo-400"
            >
              {shortId(e.id)}
            </a>
          </td>
          <td className={td}><StatusChip status={e.status} /></td>
          <td className={td}>{LANGUAGES[e.language]?.label ?? e.language}</td>
          <td className={`${td} whitespace-nowrap`}>{formatTime(e.createdAt)}</td>
          <td className={`${td} tabular-nums`}>{formatMs(e.wallMs)}</td>
          <td className={`${td} tabular-nums`}>{e.exitCode ?? '—'}</td>
        </tr>
      ))}
    </Table>
  );
}
