'use client'

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

/**
 * Client-only markdown renderer. Kept in its own module so AiNalyst can load
 * it via next/dynamic — the react-markdown/micromark tree (~224 KB raw) then
 * stays out of the team-route first-load bundle and is fetched on demand when
 * analysis output is first rendered.
 */
export default function Markdown({ children }: { children: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]}>
      {children}
    </ReactMarkdown>
  )
}
