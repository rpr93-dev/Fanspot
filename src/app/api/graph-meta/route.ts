import { NextResponse } from 'next/server'
import { readFile, stat } from 'fs/promises'
import path from 'path'

const OUT = path.join(process.cwd(), 'graphify-out')

async function fileMeta(name: string) {
  try {
    const st = await stat(path.join(OUT, name))
    return { mtime: st.mtime.toISOString(), size: st.size }
  } catch {
    return null
  }
}

/** GET /api/graph-meta — freshness info so /graph knows when to reload. */
export async function GET() {
  // Internal architecture visualization — not a production surface.
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  const [html, json] = await Promise.all([fileMeta('graph.html'), fileMeta('graph.json')])
  let nodes: number | null = null
  let links: number | null = null
  try {
    const raw = await readFile(path.join(OUT, 'graph.json'), 'utf-8')
    const d = JSON.parse(raw)
    nodes = Array.isArray(d.nodes) ? d.nodes.length : null
    links = Array.isArray(d.links) ? d.links.length : null
  } catch {
    // leave nulls
  }
  return NextResponse.json({ html, json, nodes, links })
}
