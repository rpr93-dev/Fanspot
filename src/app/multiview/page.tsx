import type { Metadata } from 'next'
import { Suspense } from 'react'
import { MultiviewClient } from './MultiviewClient'

export const metadata: Metadata = {
  title: 'Split Screen - Fanspot',
  description: 'Watch up to four games side by side — any mix of NFL, NBA, NHL, MLB and NFL RedZone.',
}

export default function MultiviewPage() {
  return (
    <Suspense fallback={<div className="min-h-screen fs-page" aria-hidden="true" />}>
      <MultiviewClient />
    </Suspense>
  )
}
