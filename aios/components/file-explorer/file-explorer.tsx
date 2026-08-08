'use client'

import {
  ChevronRightIcon,
  ChevronDownIcon,
  FolderIcon,
  FolderOpenIcon,
  FileIcon,
  FileCodeIcon,
  FileJsonIcon,
  FileTextIcon,
  XIcon,
} from 'lucide-react'
import { FileContent } from '@/components/file-explorer/file-content'
import { ScrollArea } from '@/components/ui/scroll-area'
import { buildFileTree, type FileNode } from './build-file-tree'
import { useState, useMemo, useEffect, useCallback, memo } from 'react'
import { cn } from '@/lib/utils'

interface Props {
  className: string
  disabled?: boolean
  paths: string[]
  sandboxId?: string
}

function getFileIcon(name: string) {
  const ext = name.split('.').pop()?.toLowerCase()
  if (['ts', 'tsx', 'js', 'jsx', 'mjs'].includes(ext ?? ''))
    return <FileCodeIcon className="w-3.5 h-3.5 text-cyan-400/80 flex-shrink-0" />
  if (['json', 'jsonc'].includes(ext ?? ''))
    return <FileJsonIcon className="w-3.5 h-3.5 text-yellow-400/70 flex-shrink-0" />
  if (['md', 'txt'].includes(ext ?? ''))
    return <FileTextIcon className="w-3.5 h-3.5 text-slate-400/80 flex-shrink-0" />
  if (['css', 'scss', 'sass'].includes(ext ?? ''))
    return <FileCodeIcon className="w-3.5 h-3.5 text-purple-400/80 flex-shrink-0" />
  return <FileIcon className="w-3.5 h-3.5 text-slate-500/80 flex-shrink-0" />
}

export const FileExplorer = memo(function FileExplorer({
  className,
  disabled,
  paths,
  sandboxId,
}: Props) {
  const fileTree = useMemo(() => buildFileTree(paths), [paths])
  const [selected, setSelected] = useState<FileNode | null>(null)
  const [fs, setFs] = useState<FileNode[]>(fileTree)

  useEffect(() => { setFs(fileTree) }, [fileTree])

  const toggleFolder = useCallback((path: string) => {
    setFs((prev) => {
      const update = (nodes: FileNode[]): FileNode[] =>
        nodes.map((n) =>
          n.path === path && n.type === 'folder'
            ? { ...n, expanded: !n.expanded }
            : n.children
            ? { ...n, children: update(n.children) }
            : n
        )
      return update(prev)
    })
  }, [])

  const selectFile = useCallback((node: FileNode) => {
    if (node.type === 'file') setSelected(node)
  }, [])

  const renderTree = useCallback(
    (nodes: FileNode[], depth = 0): React.ReactNode =>
      nodes.map((node) => (
        <FileTreeNode
          key={node.path}
          node={node}
          depth={depth}
          selected={selected}
          onToggleFolder={toggleFolder}
          onSelectFile={selectFile}
          renderTree={renderTree}
        />
      )),
    [selected, toggleFolder, selectFile]
  )

  return (
    <div className={cn('flex h-full w-full overflow-hidden rounded-lg border border-cyan-500/15 bg-[#0d1117]', className)}>
      {/* VS Code-style sidebar */}
      <div className="flex flex-col w-[220px] flex-shrink-0 border-r border-white/5">
        {/* Explorer header */}
        <div className="flex items-center px-3 py-2 border-b border-white/5 bg-[#0a0f16]">
          <span className="text-[0.6rem] font-bold uppercase tracking-widest text-slate-500 select-none">
            Explorer
          </span>
        </div>
        {/* Tree section label */}
        <div className="flex items-center px-3 py-1.5 bg-[#0c1018]">
          <ChevronDownIcon className="w-3 h-3 text-slate-600 mr-1" />
          <span className="text-[0.65rem] font-bold uppercase tracking-wider text-slate-400 select-none">
            Sandbox Files
          </span>
        </div>
        {/* Tree */}
        <ScrollArea className="flex-1">
          <div className="py-1">
            {fs.length === 0 ? (
              <p className="text-xs text-slate-600 px-4 py-3">No files yet</p>
            ) : (
              renderTree(fs)
            )}
          </div>
        </ScrollArea>
      </div>

      {/* Editor area */}
      <div className="flex-1 flex flex-col min-w-0 bg-[#0d1117]">
        {selected && !disabled ? (
          <>
            {/* File tab bar */}
            <div className="flex items-center border-b border-white/5 bg-[#0a0f16] flex-shrink-0 overflow-x-auto">
              <div className="flex items-center gap-0 min-w-0">
                <div className="flex items-center gap-2 px-3 py-1.5 border-r border-white/5 border-t-2 border-t-cyan-500 bg-[#0d1117] text-cyan-300 min-w-0 flex-shrink-0">
                  {getFileIcon(selected.name)}
                  <span className="text-xs font-mono whitespace-nowrap max-w-[160px] truncate">
                    {selected.name}
                  </span>
                  <button
                    onClick={() => setSelected(null)}
                    className="ml-1 text-slate-600 hover:text-slate-300 flex-shrink-0"
                  >
                    <XIcon className="w-3 h-3" />
                  </button>
                </div>
              </div>
            </div>

            {/* Monaco editor */}
            <div className="flex-1 min-h-0 overflow-hidden">
              <FileContent
                sandboxId={sandboxId!}
                path={selected.path.substring(1)}
              />
            </div>

            {/* Status bar */}
            <div className="flex items-center px-3 py-0.5 bg-cyan-900/20 border-t border-cyan-500/10 flex-shrink-0">
              <span className="text-[0.6rem] font-mono text-cyan-700 truncate">
                {selected.path}
              </span>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center space-y-2">
              <FileCodeIcon className="w-10 h-10 text-slate-700 mx-auto" />
              <p className="text-xs text-slate-600 font-mono">
                Select a file to view
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
})

const FileTreeNode = memo(function FileTreeNode({
  node, depth, selected, onToggleFolder, onSelectFile, renderTree,
}: {
  node: FileNode
  depth: number
  selected: FileNode | null
  onToggleFolder: (path: string) => void
  onSelectFile: (node: FileNode) => void
  renderTree: (nodes: FileNode[], depth: number) => React.ReactNode
}) {
  const handleClick = useCallback(() => {
    if (node.type === 'folder') onToggleFolder(node.path)
    else onSelectFile(node)
  }, [node, onToggleFolder, onSelectFile])

  const isSelected = selected?.path === node.path

  return (
    <div>
      <div
        className={cn(
          'flex items-center py-[3px] pr-2 cursor-pointer select-none transition-colors duration-75 group',
          isSelected
            ? 'bg-cyan-500/15 text-cyan-200'
            : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
        )}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        onClick={handleClick}
      >
        {node.type === 'folder' ? (
          <>
            {node.expanded
              ? <ChevronDownIcon className="w-3.5 h-3.5 flex-shrink-0 text-slate-600 mr-0.5" />
              : <ChevronRightIcon className="w-3.5 h-3.5 flex-shrink-0 text-slate-700 mr-0.5" />}
            {node.expanded
              ? <FolderOpenIcon className="w-3.5 h-3.5 flex-shrink-0 text-cyan-500/60 mr-1.5" />
              : <FolderIcon className="w-3.5 h-3.5 flex-shrink-0 text-cyan-600/50 mr-1.5" />}
          </>
        ) : (
          <>
            <span className="w-3.5 h-3.5 mr-0.5 flex-shrink-0" />
            <span className="mr-1.5">{getFileIcon(node.name)}</span>
          </>
        )}
        <span className="text-xs leading-tight truncate">{node.name}</span>
      </div>

      {node.type === 'folder' && node.expanded && node.children && (
        <div>{renderTree(node.children, depth + 1)}</div>
      )}
    </div>
  )
})
