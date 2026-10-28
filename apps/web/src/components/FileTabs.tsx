import { useState, type FormEvent } from 'react';
import { MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react';
import { HARD_LIMITS } from '@shared/constants.ts';
import { isSafeRelativePath } from '@shared/paths.ts';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

export interface SourceFile {
  path: string;
  content: string;
}

type Dialogue = { kind: 'add' } | { kind: 'rename'; index: number } | { kind: 'delete'; index: number } | null;

/** Validates a file name against the platform rules and the other files. */
export function validateFileName(path: string, files: SourceFile[], ignoreIndex?: number): string | null {
  if (!path) return 'Enter a file name.';
  if (!isSafeRelativePath(path)) return 'Use letters, digits, ".", "_", "-" and "/". No spaces, and no leading "/" or "..".';
  if (files.some((f, i) => f.path === path && i !== ignoreIndex)) return 'A file with that name already exists.';
  return null;
}

export function FileTabs({
  files,
  active,
  entryFile,
  onSelect,
  onAdd,
  onRename,
  onDelete,
}: {
  files: SourceFile[];
  active: number;
  entryFile: string;
  onSelect: (i: number) => void;
  onAdd: (path: string) => void;
  onRename: (index: number, path: string) => void;
  onDelete: (index: number) => void;
}) {
  const [dialogue, setDialogue] = useState<Dialogue>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const open = (d: Dialogue, initial = '') => {
    setDialogue(d);
    setName(initial);
    setError(null);
  };
  const close = () => setDialogue(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const path = name.trim();
    if (dialogue?.kind === 'add') {
      const err = validateFileName(path, files);
      if (err) return setError(err);
      onAdd(path);
    } else if (dialogue?.kind === 'rename') {
      const err = validateFileName(path, files, dialogue.index);
      if (err) return setError(err);
      onRename(dialogue.index, path);
    }
    close();
  };

  const atLimit = files.length >= HARD_LIMITS.maxFiles;

  return (
    <div className="flex items-center gap-1 border-b bg-muted/40 px-2 py-1.5">
      <div role="tablist" aria-label="Files" className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
        {files.map((f, i) => (
          <div key={f.path} className={cn('flex shrink-0 items-center rounded-md', i === active && 'bg-card shadow-raised')}>
            <button
              type="button"
              role="tab"
              aria-selected={i === active}
              onClick={() => onSelect(i)}
              className={cn(
                'px-2.5 py-1 font-mono text-xs',
                i === active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {f.path}
              {f.path === entryFile && files.length > 1 && <span className="ml-1.5 text-[10px] text-muted-foreground">entry</span>}
            </button>
            {i === active && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="size-6" aria-label={`Actions for ${f.path}`}>
                    <MoreHorizontal className="size-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuItem onSelect={() => open({ kind: 'rename', index: i }, f.path)}>
                    <Pencil className="size-4" aria-hidden /> Rename
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={files.length <= 1}
                    className="text-destructive focus:text-destructive"
                    onSelect={() => open({ kind: 'delete', index: i })}
                  >
                    <Trash2 className="size-4" aria-hidden /> Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        ))}
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 shrink-0 gap-1 px-2 text-xs"
        disabled={atLimit}
        title={atLimit ? `At most ${HARD_LIMITS.maxFiles} files` : undefined}
        onClick={() => open({ kind: 'add' })}
      >
        <Plus className="size-3.5" aria-hidden /> File
      </Button>

      <Dialog open={dialogue?.kind === 'add' || dialogue?.kind === 'rename'} onOpenChange={(o) => !o && close()}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={submit} className="space-y-4">
            <DialogHeader>
              <DialogTitle>{dialogue?.kind === 'add' ? 'New file' : 'Rename file'}</DialogTitle>
              <DialogDescription>Folders are allowed, for example utils/math.py.</DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="file-name">File name</Label>
              <Input id="file-name" autoFocus className="font-mono" value={name} onChange={(e) => { setName(e.target.value); setError(null); }} aria-invalid={!!error} aria-describedby={error ? 'file-name-error' : undefined} />
              {error && (
                <p id="file-name-error" role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={close}>
                Cancel
              </Button>
              <Button type="submit">{dialogue?.kind === 'add' ? 'Create file' : 'Rename'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={dialogue?.kind === 'delete'} onOpenChange={(o) => !o && close()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {dialogue?.kind === 'delete' ? files[dialogue.index]?.path : 'file'}?</AlertDialogTitle>
            <AlertDialogDescription>This removes the file and its contents from the editor. It cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep file</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => dialogue?.kind === 'delete' && onDelete(dialogue.index)}
            >
              Delete file
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
