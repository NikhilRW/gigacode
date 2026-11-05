import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  createLibrary,
  createWriteQueue,
  decodeLibrary,
  sourceFilename,
  switchLanguage,
  removeFile,
  STORAGE_KEY,
  type Library,
} from '@/lib/drafts';
import type { Language } from '@/lib/types';

type SaveState = 'loading' | 'saved' | 'unsaved' | 'saving' | 'error';
type DraftContext = {
  library: Library;
  status: SaveState;
  error: string | null;
  ready: boolean;
  edit: (id: string, code: string) => void;
  open: (id: string) => void;
  create: (name: string) => void;
  rename: (name: string) => void;
  remove: (id: string) => void;
  setLanguage: (language: Language) => void;
  setEntry: (id: string) => void;
  configure: (
    patch: Partial<
      Pick<
        Library,
        | 'stdin'
        | 'timeoutMs'
        | 'memoryMb'
        | 'fontSize'
        | 'cpuMsPerSec'
        | 'pids'
        | 'advancedSettings'
        | 'showUsage'
        | 'network'
      >
    >,
  ) => void;
  snapshot: () => Library;
  save: () => Promise<void>;
  retry: () => void;
};
const Context = createContext<DraftContext | null>(null);

export function DraftProvider({ children }: { children: ReactNode }) {
  const [library, setLibrary] = useState(createLibrary);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState<SaveState>('loading');
  const [error, setError] = useState<string | null>(null);
  const [hydrationAttempt, setHydrationAttempt] = useState(0);
  const current = useRef(library);
  const writer = useRef(createWriteQueue((value) => AsyncStorage.setItem(STORAGE_KEY, value)));
  const revision = useRef(0);
  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (cancelled) return;
        const next = raw ? decodeLibrary(raw) : createLibrary();
        current.current = next;
        setLibrary(next);
        setReady(true);
        setError(null);
        setStatus(raw ? 'saved' : 'unsaved');
      })
      .catch(() => {
        if (cancelled) return;
        setError(
          'Your device drafts could not be opened. Nothing was overwritten. Check storage access, then retry.',
        );
        setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [hydrationAttempt]);

  const save = useCallback(async () => {
    if (!ready) return;
    const savingRevision = revision.current;
    setStatus('saving');
    try {
      await writer.current(current.current);
      if (savingRevision === revision.current) {
        setStatus('saved');
        setError(null);
      }
    } catch {
      setStatus('error');
      setError('Could not save to this device. Your changes are still in this session. Please retry Save.');
    }
  }, [ready]);
  useEffect(() => {
    if (!ready || status !== 'unsaved') return;
    const timer = setTimeout(() => {
      void save();
    }, 600);
    return () => clearTimeout(timer);
  }, [library, ready, save, status]);

  const update = (next: Library) => {
    revision.current += 1;
    current.current = next;
    setLibrary(next);
    if (ready) setStatus('unsaved');
  };
  const edit = (id: string, code: string) => {
    if (!ready || !current.current.files.some((file) => file.id === id && file.code !== code)) return;
    update({
      ...current.current,
      files: current.current.files.map((file) =>
        file.id === id ? { ...file, code, updatedAt: Date.now() } : file,
      ),
    });
  };
  const open = (id: string) => {
    const file = current.current.files.find((file) => file.id === id);
    if (ready && file) update({ ...current.current, activeId: id, language: file.language });
  };
  const create = (input: string) => {
    if (!ready) return;
    const language = current.current.language;
    if (current.current.files.filter((file) => file.language === language).length >= 20)
      throw new Error('A run supports at most 20 files.');
    const name = sourceFilename(input, current.current.files, language);
    const id = `draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    update({
      ...current.current,
      activeId: id,
      files: [...current.current.files, { id, language, name, code: '', updatedAt: Date.now() }],
    });
  };
  const rename = (input: string) => {
    if (!ready) return;
    const name = sourceFilename(
      input,
      current.current.files,
      current.current.language,
      current.current.activeId,
    );
    update({
      ...current.current,
      files: current.current.files.map((file) =>
        file.id === current.current.activeId ? { ...file, name, updatedAt: Date.now() } : file,
      ),
    });
  };
  const retry = () => {
    if (ready) return;
    setStatus('loading');
    setError(null);
    setHydrationAttempt((attempt) => attempt + 1);
  };
  const remove = (id: string) => {
    if (ready) update(removeFile(current.current, id));
  };
  const setLanguage = (language: Language) => {
    if (ready) update(switchLanguage(current.current, language));
  };
  const setEntry = (id: string) => {
    if (
      ready &&
      current.current.files.some((file) => file.id === id && file.language === current.current.language)
    )
      update({ ...current.current, entries: { ...current.current.entries, [current.current.language]: id } });
  };
  const configure: DraftContext['configure'] = (patch) => {
    if (ready) update({ ...current.current, ...patch });
  };
  return (
    <Context.Provider
      value={{
        library,
        status,
        ready,
        error,
        edit,
        open,
        create,
        rename,
        remove,
        setLanguage,
        setEntry,
        configure,
        snapshot: () => current.current,
        save,
        retry,
      }}
    >
      {children}
    </Context.Provider>
  );
}

export function useDrafts() {
  const context = useContext(Context);
  if (!context) throw new Error('useDrafts requires DraftProvider');
  return context;
}
