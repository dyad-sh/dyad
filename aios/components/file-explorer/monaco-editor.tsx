'use client'

import { useEffect } from 'react'
import Editor, { useMonaco } from '@monaco-editor/react'
import type { Monaco } from '@monaco-editor/react'

type IStandaloneThemeData = Parameters<Monaco['editor']['defineTheme']>[1]

export const HOLOGRAPHIC_THEME: IStandaloneThemeData = {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: '', foreground: 'c9d1d9' },
    { token: 'comment', foreground: '3d5a6b', fontStyle: 'italic' },
    { token: 'keyword', foreground: '00e5ff', fontStyle: 'bold' },
    { token: 'keyword.control', foreground: '00e5ff' },
    { token: 'string', foreground: '00e676' },
    { token: 'string.escape', foreground: '00bfa5' },
    { token: 'number', foreground: 'f48fb1' },
    { token: 'type', foreground: '64b5f6' },
    { token: 'type.identifier', foreground: '64b5f6' },
    { token: 'function', foreground: 'ce93d8' },
    { token: 'variable', foreground: 'e2e8f0' },
    { token: 'variable.predefined', foreground: '00e5ff' },
    { token: 'operator', foreground: '00acc1' },
    { token: 'delimiter', foreground: '4a6572' },
    { token: 'delimiter.bracket', foreground: '546e7a' },
    { token: 'tag', foreground: '00e5ff' },
    { token: 'tag.id', foreground: '00e5ff' },
    { token: 'attribute.name', foreground: '64b5f6' },
    { token: 'attribute.value', foreground: '00e676' },
    { token: 'metatag', foreground: 'f48fb1' },
    { token: 'regexp', foreground: 'f48fb1' },
    { token: 'constant', foreground: 'f48fb1' },
    { token: 'namespace', foreground: 'ce93d8' },
    { token: 'class', foreground: '64b5f6' },
    { token: 'interface', foreground: '64b5f6' },
    { token: 'enum', foreground: '64b5f6' },
  ],
  colors: {
    'editor.background': '#000d1a',
    'editor.foreground': '#c9d1d9',
    'editorLineNumber.foreground': '#1a3a50',
    'editorLineNumber.activeForeground': '#00acc1',
    'editorCursor.foreground': '#00e5ff',
    'editor.selectionBackground': '#003d5c',
    'editor.inactiveSelectionBackground': '#002233',
    'editor.lineHighlightBackground': '#001828',
    'editor.lineHighlightBorder': '#002535',
    'editorIndentGuide.background1': '#0a1e2c',
    'editorIndentGuide.activeBackground1': '#1a3a4a',
    'editorWhitespace.foreground': '#0f2535',
    'editorBracketMatch.background': '#003d5c',
    'editorBracketMatch.border': '#00acc1',
    'editor.findMatchBackground': '#003d5c',
    'editor.findMatchHighlightBackground': '#002233',
    'scrollbar.shadow': '#000000',
    'scrollbarSlider.background': '#00e5ff14',
    'scrollbarSlider.hoverBackground': '#00e5ff28',
    'scrollbarSlider.activeBackground': '#00e5ff3d',
    'editorGutter.background': '#000d1a',
    'editorOverviewRuler.border': '#001828',
    'editorWidget.background': '#001828',
    'editorWidget.border': '#00acc130',
    'editorSuggestWidget.background': '#001828',
    'editorSuggestWidget.border': '#00acc130',
    'editorSuggestWidget.selectedBackground': '#003d5c',
  },
}

const LANGUAGE_MAP: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
  mjs: 'javascript', cjs: 'javascript', py: 'python', pyw: 'python',
  html: 'html', htm: 'html', css: 'css', scss: 'scss', sass: 'scss',
  less: 'less', json: 'json', jsonc: 'json', md: 'markdown', yaml: 'yaml',
  yml: 'yaml', toml: 'ini', xml: 'xml', svg: 'xml', sh: 'shell',
  bash: 'shell', zsh: 'shell', fish: 'shell', go: 'go', rs: 'rust',
  java: 'java', kt: 'kotlin', swift: 'swift', cs: 'csharp', cpp: 'cpp',
  cxx: 'cpp', cc: 'cpp', c: 'c', h: 'c', hpp: 'cpp', php: 'php',
  rb: 'ruby', sql: 'sql', graphql: 'graphql', gql: 'graphql',
  dockerfile: 'dockerfile', env: 'ini', tf: 'hcl', prisma: 'prisma',
}

export function getLanguage(path: string): string {
  const filename = path.split('/').pop() ?? path
  if (filename.toLowerCase() === 'dockerfile') return 'dockerfile'
  if (filename.startsWith('.env')) return 'ini'
  const ext = filename.split('.').pop()?.toLowerCase()
  return LANGUAGE_MAP[ext ?? ''] ?? 'plaintext'
}

interface Props {
  path: string
  code: string
}

export function MonacoFileViewer({ path, code }: Props) {
  const monaco = useMonaco()

  useEffect(() => {
    if (!monaco) return
    monaco.editor.defineTheme('holographic', HOLOGRAPHIC_THEME)
    monaco.editor.setTheme('holographic')
  }, [monaco])

  return (
    <Editor
      height="100%"
      language={getLanguage(path)}
      value={code}
      theme="holographic"
      options={{
        readOnly: true,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        fontSize: 13,
        lineNumbers: 'on',
        renderLineHighlight: 'all',
        fontFamily: '"Geist Mono", "Cascadia Code", "Fira Code", monospace',
        fontLigatures: true,
        padding: { top: 12, bottom: 12 },
        scrollbar: {
          verticalScrollbarSize: 6,
          horizontalScrollbarSize: 6,
          useShadows: false,
        },
        overviewRulerLanes: 0,
        hideCursorInOverviewRuler: true,
        stickyScroll: { enabled: false },
        renderWhitespace: 'none',
        wordWrap: 'off',
        contextmenu: false,
        automaticLayout: true,
        smoothScrolling: true,
        cursorBlinking: 'smooth',
        bracketPairColorization: { enabled: true },
      }}
      loading={
        <div className="flex items-center justify-center h-full w-full">
          <div className="holo-loader" />
        </div>
      }
    />
  )
}
