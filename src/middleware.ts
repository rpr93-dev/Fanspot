import { NextResponse } from 'next/server'

export function middleware(req: Request) {
  const url = new URL(req.url)
  const proto = req.headers.get('x-forwarded-proto')

  if (proto === 'http') {
    const redirect = new URL(url.toString())
    redirect.protocol = 'https'
    return NextResponse.redirect(redirect)
  }

  if (proto !== 'https' && url.hostname !== 'localhost' && process.env.NODE_ENV !== 'development') {
    const redirect = new URL(url.toString())
    redirect.protocol = 'https'
    return NextResponse.redirect(redirect)
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|public/).*)'],
}
