import type { Language } from './types';
export const languageIds: Language[] = ['python', 'node', 'c', 'cpp'];
export const languages: Record<Language, { label: string; extension: string; entry: string; starter: string }> = {
  python: { label: 'Python', extension: '.py', entry: 'main.py', starter: 'print("Hello, universe!")\n' },
  node: { label: 'Node.js', extension: '.js', entry: 'index.js', starter: 'console.log("Hello, universe!");\n' },
  c: { label: 'C', extension: '.c', entry: 'main.c', starter: '#include <stdio.h>\n\nint main(void) {\n    puts("Hello, universe!");\n    return 0;\n}\n' },
  cpp: { label: 'C++17', extension: '.cpp', entry: 'main.cpp', starter: '#include <iostream>\n\nint main() {\n    std::cout << "Hello, universe!" << std::endl;\n    return 0;\n}\n' },
};
