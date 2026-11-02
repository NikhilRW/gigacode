import { useCallback, useEffect, useRef } from 'react';
import type { EditorHandle } from '../components/CodeEditor';

type Document = { fileId: string; code: string };
type Pending = {
  resolve: (document: Document) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

/** Native → DOM ref calls return void. DOM → native actions carry the reply. */
export function useEditorBridge(fileId: string, focusEditor: boolean) {
  const editor = useRef<EditorHandle>(null);
  const pending = useRef(new Map<string, Pending>());
  const sequence = useRef(0);

  useEffect(() => {
    const requests = pending.current;
    return () => {
      for (const request of requests.values()) {
        clearTimeout(request.timer);
        request.reject(new Error('The editor changed before it replied. Please try again.'));
      }
      requests.clear();
    };
  }, [fileId, focusEditor]);

  const readDocument = useCallback(() => new Promise<Document>((resolve, reject) => {
    const request = editor.current?.requestDocument;
    if (typeof request !== 'function') {
      reject(new Error('The editor is still opening. Try again in a moment.'));
      return;
    }
    const id = String(++sequence.current);
    const timer = setTimeout(() => {
      pending.current.delete(id);
      reject(new Error('The editor did not reply. Your last saved draft is retained; reopen the editor and retry.'));
    }, 5000);
    pending.current.set(id, { resolve, reject, timer });
    try { request(id); }
    catch (error) {
      clearTimeout(timer);
      pending.current.delete(id);
      reject(error);
    }
  }), []);

  const onDocument = useCallback(async (requestId: string, id: string, code: string) => {
    const request = pending.current.get(requestId);
    if (!request) return;
    pending.current.delete(requestId);
    clearTimeout(request.timer);
    request.resolve({ fileId: id, code });
  }, []);

  return { editor, readDocument, onDocument };
}
