export type LanguageId = 'python' | 'node' | 'c' | 'cpp';

export interface LanguageConfig {
  id: LanguageId;
  label: string;
  /** Directory name under SANDBOX_ROOTFS_DIR. */
  rootfs: string;
  defaultEntryFile: string;
  /** Compile command, run in /workspace. Output binary goes to /workspace/out. */
  compile?: (entryFile: string) => string[];
  run: (entryFile: string) => string[];
  /** Small program used by the worker self-test. Must print "hello". */
  helloWorld: string;
  /** Extra seccomp policy merged with the base policy (file in infra/nsjail/seccomp). */
  seccompExtra?: string;
  monaco: string;
}

export const LANGUAGES: Record<LanguageId, LanguageConfig> = {
  python: {
    id: 'python',
    label: 'Python 3.12',
    rootfs: 'python',
    defaultEntryFile: 'main.py',
    run: (entry) => ['/usr/local/bin/python3', '-I', '-B', entry],
    helloWorld: 'print("hello")\n',
    monaco: 'python',
  },
  node: {
    id: 'node',
    label: 'Node.js 20',
    rootfs: 'node',
    defaultEntryFile: 'index.js',
    run: (entry) => ['/usr/local/bin/node', entry],
    helloWorld: 'console.log("hello");\n',
    seccompExtra: 'node.kafel',
    monaco: 'javascript',
  },
  c: {
    id: 'c',
    label: 'C (gcc)',
    rootfs: 'gcc',
    defaultEntryFile: 'main.c',
    compile: (entry) => ['/usr/local/bin/gcc', '-O2', '-o', 'out', entry],
    run: () => ['./out'],
    helloWorld: '#include <stdio.h>\nint main(void){puts("hello");return 0;}\n',
    seccompExtra: 'gcc.kafel',
    monaco: 'c',
  },
  cpp: {
    id: 'cpp',
    label: 'C++17 (g++)',
    rootfs: 'gcc',
    defaultEntryFile: 'main.cpp',
    compile: (entry) => ['/usr/local/bin/g++', '-O2', '-std=c++17', '-o', 'out', entry],
    run: () => ['./out'],
    helloWorld: '#include <iostream>\nint main(){std::cout<<"hello"<<std::endl;return 0;}\n',
    seccompExtra: 'gcc.kafel',
    monaco: 'cpp',
  },
};

export const LANGUAGE_IDS = Object.keys(LANGUAGES) as LanguageId[];
