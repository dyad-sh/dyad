'use client'

import type { ChatUIMessage } from '@/components/chat/types'
import { TEST_PROMPTS } from '@/ai/constants'
import {
  ArrowUpIcon,
  SparklesIcon,
  SquareIcon,
  PlusIcon,
  PaperclipIcon,
  ImageIcon,
  MonitorIcon,
  XIcon,
} from 'lucide-react'
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation'
import { Message } from '@/components/chat/message'
import { ModelSelector } from '@/components/settings/model-selector'
import { Panel } from '@/components/panels/panels'
import { Settings } from '@/components/settings/settings'
import { useChat } from '@ai-sdk/react'
import { useLocalStorageValue } from '@/lib/use-local-storage-value'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useSharedChatContext } from '@/lib/chat-context'
import { useSettings } from '@/components/settings/use-settings'
import { useSandboxStore } from './state'
import { cn } from '@/lib/utils'

interface Props {
  className: string
}

interface Attachment {
  id: string
  file: File
  previewUrl: string
}

function fileToDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export function Chat({ className }: Props) {
  const [input, setInput] = useLocalStorageValue('prompt-input')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [menuOpen, setMenuOpen] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { chat } = useSharedChatContext()
  const { modelId, reasoningEffort } = useSettings()
  const { messages, sendMessage, status, stop } = useChat<ChatUIMessage>({ chat })
  const { setChatStatus } = useSandboxStore()
  const isLoading = status === 'streaming' || status === 'submitted'

  const adjustHeight = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`
  }, [])

  const addFiles = useCallback((files: File[]) => {
    if (files.length === 0) return
    setAttachments((prev) => [
      ...prev,
      ...files.map((file) => ({
        id: crypto.randomUUID(),
        file,
        previewUrl: URL.createObjectURL(file),
      })),
    ])
  }, [])

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => {
      const found = prev.find((a) => a.id === id)
      if (found) URL.revokeObjectURL(found.previewUrl)
      return prev.filter((a) => a.id !== id)
    })
  }, [])

  // Clean up object URLs on unmount.
  useEffect(() => {
    return () => attachments.forEach((a) => URL.revokeObjectURL(a.previewUrl))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const openFilePicker = (accept: string) => {
    if (fileInputRef.current) {
      fileInputRef.current.accept = accept
      fileInputRef.current.click()
    }
    setMenuOpen(false)
  }

  const takeScreenshot = useCallback(async () => {
    setMenuOpen(false)
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
      })
      const video = document.createElement('video')
      video.srcObject = stream
      await video.play()
      const canvas = document.createElement('canvas')
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      canvas.getContext('2d')?.drawImage(video, 0, 0)
      stream.getTracks().forEach((t) => t.stop())
      canvas.toBlob((blob) => {
        if (blob) {
          addFiles([
            new File([blob], `screenshot-${Date.now()}.png`, {
              type: 'image/png',
            }),
          ])
        }
      }, 'image/png')
    } catch {
      /* user cancelled the picker */
    }
  }, [addFiles])

  const validateAndSubmitMessage = useCallback(
    async (text: string) => {
      if (isLoading) return
      if (!text.trim() && attachments.length === 0) return

      const fileParts = await Promise.all(
        attachments.map(async (a) => ({
          type: 'file' as const,
          mediaType: a.file.type || 'application/octet-stream',
          filename: a.file.name,
          url: await fileToDataURL(a.file),
        }))
      )

      sendMessage(
        fileParts.length ? { text, files: fileParts } : { text },
        { body: { modelId, reasoningEffort } }
      )

      setInput('')
      attachments.forEach((a) => URL.revokeObjectURL(a.previewUrl))
      setAttachments([])
      if (textareaRef.current) textareaRef.current.style.height = 'auto'
    },
    [sendMessage, modelId, setInput, reasoningEffort, isLoading, attachments]
  )

  useEffect(() => {
    setChatStatus(status)
  }, [status, setChatStatus])

  const canSend = !isLoading && (input.trim().length > 0 || attachments.length > 0)

  return (
    <Panel className={cn('flex flex-col overflow-hidden', className)}>
      {/* Header */}
      <div className="holo-panel-header flex items-center px-3 py-2 flex-shrink-0">
        <SparklesIcon className="w-3.5 h-3.5 mr-2 text-cyan-400 flex-shrink-0" />
        <span className="font-mono text-xs font-bold uppercase tracking-wider text-cyan-200">
          Chat
        </span>
        {isLoading && (
          <div className="ml-2.5 flex items-center gap-0.5">
            {[0, 150, 300].map((delay) => (
              <span
                key={delay}
                className="w-1 h-1 rounded-full bg-cyan-400 animate-bounce"
                style={{ animationDelay: `${delay}ms` }}
              />
            ))}
          </div>
        )}
        <span className="ml-auto font-mono text-xs text-slate-600 select-none">
          {status}
        </span>
      </div>

      {/* Messages / Empty state */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {messages.length === 0 ? (
          <div className="flex flex-col justify-center items-center h-full px-4 gap-4">
            <div className="text-center space-y-1.5">
              <p className="text-sm font-semibold text-slate-200">
                Start building something
              </p>
              <p className="text-xs text-slate-500">
                Try one of these prompts to get started:
              </p>
            </div>
            <ul className="w-full space-y-1.5">
              {TEST_PROMPTS.map((prompt, idx) => (
                <li
                  key={idx}
                  className="px-3 py-2 rounded-lg border border-cyan-500/12 bg-cyan-500/5 text-xs text-slate-400 cursor-pointer hover:bg-cyan-500/10 hover:text-slate-200 hover:border-cyan-500/28 transition-all duration-150 leading-snug"
                  onClick={() => validateAndSubmitMessage(prompt)}
                >
                  {prompt}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <Conversation className="relative h-full">
            <ConversationContent className="px-3 py-4 space-y-5">
              {messages.map((message) => (
                <Message key={message.id} message={message} />
              ))}
            </ConversationContent>
            <ConversationScrollButton />
          </Conversation>
        )}
      </div>

      {/* Lovable-style input area */}
      <div className="flex-shrink-0 p-2.5">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            validateAndSubmitMessage(input)
          }}
          className="claude-input-wrap"
        >
          {/* Attachment chips */}
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-1.5 px-2.5 pt-2.5">
              {attachments.map((a) => {
                const isImage = a.file.type.startsWith('image/')
                return (
                  <div
                    key={a.id}
                    className="group relative flex items-center gap-1.5 h-8 pl-1 pr-2 rounded-md border border-cyan-500/20 bg-black/40"
                  >
                    {isImage ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={a.previewUrl}
                        alt={a.file.name}
                        className="w-6 h-6 rounded object-cover"
                      />
                    ) : (
                      <span className="flex items-center justify-center w-6 h-6 rounded bg-cyan-500/10">
                        <PaperclipIcon className="w-3 h-3 text-cyan-400" />
                      </span>
                    )}
                    <span className="text-[0.7rem] font-mono text-slate-300 max-w-[110px] truncate">
                      {a.file.name}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeAttachment(a.id)}
                      className="text-slate-500 hover:text-red-400 transition-colors"
                      title="Remove"
                    >
                      <XIcon className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )
              })}
            </div>
          )}

          {/* Textarea */}
          <textarea
            ref={textareaRef}
            className="claude-textarea"
            disabled={isLoading}
            onChange={(e) => {
              setInput(e.target.value)
              adjustHeight()
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                validateAndSubmitMessage(input)
              }
            }}
            onPaste={(e) => {
              const imgs = Array.from(e.clipboardData.files).filter((f) =>
                f.type.startsWith('image/')
              )
              if (imgs.length) {
                e.preventDefault()
                addFiles(imgs)
              }
            }}
            placeholder="Ask Helix… (⏎ send · ⇧⏎ newline)"
            rows={1}
            value={input}
          />

          {/* Bottom toolbar */}
          <div className="flex items-center gap-1 px-2 pb-2 pt-0.5">
            {/* Attach menu */}
            <div className="relative">
              {menuOpen && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setMenuOpen(false)}
                  />
                  <div className="absolute bottom-full mb-2 left-0 z-50 w-44 rounded-lg border border-cyan-500/20 bg-[#0a121c] shadow-[0_8px_30px_rgba(0,0,0,0.6)] py-1 overflow-hidden">
                    <MenuItem
                      icon={<ImageIcon className="w-3.5 h-3.5" />}
                      label="Attach image"
                      onClick={() => openFilePicker('image/*')}
                    />
                    <MenuItem
                      icon={<PaperclipIcon className="w-3.5 h-3.5" />}
                      label="Attach file"
                      onClick={() => openFilePicker('*/*')}
                    />
                    <MenuItem
                      icon={<MonitorIcon className="w-3.5 h-3.5" />}
                      label="Take a screenshot"
                      onClick={takeScreenshot}
                    />
                  </div>
                </>
              )}
              <button
                type="button"
                onClick={() => setMenuOpen((v) => !v)}
                title="Attach"
                className={cn(
                  'flex items-center justify-center w-8 h-8 rounded-md border transition-all',
                  menuOpen
                    ? 'text-cyan-200 border-cyan-500/40 bg-cyan-500/15'
                    : 'text-cyan-400 border-cyan-500/15 hover:text-cyan-200 hover:bg-cyan-500/10'
                )}
              >
                <PlusIcon className="w-4 h-4" />
              </button>
            </div>

            <ModelSelector />
            <Settings />

            <div className="flex-1" />

            {/* Send / Stop */}
            <button
              type={isLoading ? 'button' : 'submit'}
              onClick={isLoading ? () => stop() : undefined}
              disabled={!isLoading && !canSend}
              title={isLoading ? 'Stop generating' : 'Send'}
              className={cn(
                'flex items-center justify-center w-8 h-8 rounded-full transition-all duration-200 flex-shrink-0',
                isLoading
                  ? 'bg-red-500/90 hover:bg-red-500 text-white shadow-[0_0_14px_rgba(239,68,68,0.45)] cursor-pointer'
                  : canSend
                    ? 'bg-cyan-500 hover:bg-cyan-400 text-black shadow-[0_0_14px_rgba(0,210,255,0.45)] cursor-pointer'
                    : 'bg-slate-800/60 text-slate-600 cursor-not-allowed'
              )}
            >
              {isLoading ? (
                <SquareIcon className="w-3 h-3 fill-current" />
              ) : (
                <ArrowUpIcon className="w-4 h-4" strokeWidth={2.5} />
              )}
            </button>
          </div>

          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              addFiles(Array.from(e.target.files ?? []))
              e.target.value = ''
            }}
          />
        </form>
      </div>
    </Panel>
  )
}

function MenuItem({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-2.5 w-full px-3 py-2 text-xs font-medium text-slate-300 hover:bg-cyan-500/10 hover:text-cyan-200 transition-colors"
    >
      <span className="text-cyan-400">{icon}</span>
      {label}
    </button>
  )
}
