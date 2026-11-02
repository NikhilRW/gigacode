import { snippetCompletion, type Completion, type CompletionContext } from '@codemirror/autocomplete';
import type { Language } from './types';

// Curated local suggestions, not a language server or remote AI service.
export const snippets: Record<Language, { label: string; detail: string; template: string }[]> = {
  python: [
    { label: 'print', detail: 'print a value', template: 'print(${value})' },
    { label: 'for', detail: 'iterate a sequence', template: 'for ${item} in ${items}:\n    ${pass}' },
    { label: 'for-range', detail: 'counted loop', template: 'for ${i} in range(${10}):\n    ${pass}' },
    { label: 'def', detail: 'define a function', template: 'def ${name}(${args}):\n    ${pass}' },
    { label: 'if', detail: 'conditional block', template: 'if ${condition}:\n    ${pass}' },
    { label: 'try', detail: 'handle an exception', template: 'try:\n    ${pass}\nexcept ${Exception} as ${error}:\n    print(${error})' },
    { label: 'class', detail: 'define a class', template: 'class ${Name}:\n    def __init__(self, ${args}):\n        ${pass}' },
    { label: 'main', detail: 'script entry guard', template: 'if __name__ == "__main__":\n    ${pass}' },
  ],
  node: [
    { label: 'console.log', detail: 'write stdout', template: 'console.log(${value});' },
    { label: 'function', detail: 'named function', template: 'function ${name}(${args}) {\n    ${return value;}\n}' },
    { label: 'for', detail: 'iterate values', template: 'for (const ${item} of ${items}) {\n    ${console.log(item);}\n}' },
    { label: 'async', detail: 'async function', template: 'async function ${name}(${args}) {\n    ${return value;}\n}' },
    { label: 'stdin', detail: 'read standard input', template: 'const ${input} = require("fs").readFileSync(0, "utf8");' },
  ],
  c: [
    { label: 'printf', detail: 'formatted stdout', template: 'printf("${%d}\\n", ${value});' },
    { label: 'for', detail: 'counted loop', template: 'for (int ${i} = 0; ${i} < ${n}; ${i}++) {\n    ${}\n}' },
    { label: 'main', detail: 'program entry', template: 'int main(void) {\n    ${}\n    return 0;\n}' },
    { label: 'include', detail: 'standard library header', template: '#include <${stdio.h}>' },
  ],
  cpp: [
    { label: 'std::cout', detail: 'write stdout', template: 'std::cout << ${value} << std::endl;' },
    { label: 'for', detail: 'range loop', template: 'for (const auto& ${item} : ${items}) {\n    ${}\n}' },
    { label: 'main', detail: 'program entry', template: 'int main() {\n    ${}\n    return 0;\n}' },
    { label: 'vector', detail: 'dynamic array', template: 'std::vector<${int}> ${values};' },
    { label: 'include', detail: 'standard library header', template: '#include <${iostream}>' },
  ],
};
const builtins: Record<Language, string[]> = {
  python: ['abs', 'all', 'any', 'bool', 'dict', 'enumerate', 'filter', 'float', 'input', 'int', 'isinstance', 'len', 'list', 'map', 'max', 'min', 'open', 'range', 'reversed', 'round', 'set', 'sorted', 'str', 'sum', 'tuple', 'type', 'zip', 'True', 'False', 'None', 'import', 'from', 'return', 'while', 'break', 'continue', 'with', 'lambda'],
  node: ['Array.from', 'Array.isArray', 'JSON.parse', 'JSON.stringify', 'Math.max', 'Math.min', 'Math.floor', 'Object.keys', 'Object.entries', 'Promise.all', 'require', 'process.stdin', 'process.stdout.write', 'const', 'let', 'return', 'await', 'if', 'else', 'map', 'filter', 'reduce'],
  c: ['puts', 'scanf', 'fgets', 'strlen', 'strcmp', 'memcpy', 'malloc', 'free', 'sizeof', 'return', 'if', 'else', 'while', 'struct', 'typedef', 'NULL', 'int', 'double', 'char'],
  cpp: ['std::cin', 'std::string', 'std::vector', 'std::sort', 'std::map', 'std::set', 'std::max', 'std::min', 'std::getline', 'std::endl', 'auto', 'const', 'return', 'if', 'else', 'while', 'class', 'public', 'nullptr'],
};
export function completionItems(language: Language): Completion[] {
  const labels = new Set(snippets[language].map(item => item.label));
  return [...snippets[language].map(item => snippetCompletion(item.template, { label: item.label, detail: item.detail, type: 'function', boost: 5 })),
    ...builtins[language].filter(label => !labels.has(label)).map(label => ({ label, type: 'keyword', detail: `${language} builtin / keyword` }))];
}
export function completionSource(language: Language) {
  const options = completionItems(language);
  return (context: CompletionContext) => {
    const word = context.matchBefore(/[\w.:]+/);
    if (!word && !context.explicit) return null;
    const known = new Set(options.map(item => item.label));
    const local = Array.from(new Set(context.state.doc.toString().match(/\b[a-zA-Z_][a-zA-Z_0-9]*\b/g) ?? []))
      .filter(label => !known.has(label)).slice(0, 300).map(label => ({ label, type: 'variable', detail: 'in this file' }));
    return { from: word?.from ?? context.pos, options: [...options, ...local], validFor: /^[\w.:]*$/ };
  };
}
