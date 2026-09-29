import { NextResponse } from 'next/server'
import { readFile, stat } from 'fs/promises'
import path from 'path'

const GRAPH_HTML = path.join(process.cwd(), 'graphify-out', 'graph.html')

/** GET /api/graph-html — serves the generated graphify visualization. */
export async function GET() {
  // Internal architecture visualization — not a production surface.
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  try {
    const [html, st] = await Promise.all([readFile(GRAPH_HTML, 'utf-8'), stat(GRAPH_HTML)])
    return new NextResponse(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Graph-Updated-At': st.mtime.toISOString(),
      },
    })
  } catch {
    return NextResponse.json({ error: 'graph.html not found — run `graphify .` first' }, { status: 404 })
  }
}
