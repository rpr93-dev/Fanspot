import { Barlow_Condensed, IBM_Plex_Mono, Inter } from 'next/font/google'

export const display = Barlow_Condensed({
  subsets: ['latin'],
  weight: ['600', '700', '800'],
  variable: '--font-display',
})

export const body = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-body',
})

export const mono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['500', '600'],
  variable: '--font-mono-data',
})

export const fontVariables = `${display.variable} ${body.variable} ${mono.variable}`
