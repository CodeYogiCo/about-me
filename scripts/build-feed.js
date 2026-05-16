import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, basename, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { marked } from 'marked'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const POSTS_DIR = join(ROOT, 'src/posts')
const PUBLIC_DIR = join(ROOT, 'public')

const SITE_URL = 'https://codeyogico.github.io'
const SITE_TITLE = 'Vishal Vaibhav'
const SITE_DESC = 'Notes on engineering, systems, search, and tech culture.'

function parseFrontmatter(raw) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/)
  if (!m) return { meta: {}, body: raw }
  const meta = {}
  for (const line of m[1].split(/\r?\n/)) {
    const idx = line.indexOf(':')
    if (idx === -1) continue
    const key = line.slice(0, idx).trim()
    let val = line.slice(idx + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    if (val === 'true') meta[key] = true
    else if (val === 'false') meta[key] = false
    else meta[key] = val
  }
  return { meta, body: m[2] }
}

function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function toRfc822(dateStr) {
  return new Date(`${dateStr}T00:00:00Z`).toUTCString()
}

const files = readdirSync(POSTS_DIR).filter((f) => f.endsWith('.md'))

const posts = files
  .map((f) => {
    const slug = basename(f, '.md')
    const raw = readFileSync(join(POSTS_DIR, f), 'utf8')
    const { meta, body } = parseFrontmatter(raw)
    return { slug, ...meta, body }
  })
  .filter((p) => !p.hidden)
  .sort((a, b) => (b.date || '').localeCompare(a.date || ''))

const lastBuildDate = posts[0]?.date ? toRfc822(posts[0].date) : new Date().toUTCString()

const items = posts
  .map((p) => {
    const url = `${SITE_URL}/#/post/${p.slug}`
    const html = marked.parse(p.body || '')
    return `    <item>
      <title>${escapeXml(p.title)}</title>
      <link>${escapeXml(url)}</link>
      <guid isPermaLink="false">${escapeXml(p.slug)}</guid>
      <pubDate>${toRfc822(p.date)}</pubDate>
      <description><![CDATA[${p.deck || ''}]]></description>
      <content:encoded><![CDATA[${html}]]></content:encoded>
    </item>`
  })
  .join('\n')

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>${escapeXml(SITE_TITLE)}</title>
    <link>${SITE_URL}/</link>
    <description>${escapeXml(SITE_DESC)}</description>
    <language>en-us</language>
    <atom:link href="${SITE_URL}/feed.xml" rel="self" type="application/rss+xml" />
    <lastBuildDate>${lastBuildDate}</lastBuildDate>
${items}
  </channel>
</rss>
`

if (!existsSync(PUBLIC_DIR)) mkdirSync(PUBLIC_DIR, { recursive: true })
writeFileSync(join(PUBLIC_DIR, 'feed.xml'), xml)
console.log(`feed: wrote ${posts.length} posts to public/feed.xml`)
