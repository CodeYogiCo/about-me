import { useEffect, useState } from 'react'
import { profile, posts, postBodies, genericBody } from './data'

function useTheme() {
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem('vv.theme') || 'light'
    } catch {
      return 'light'
    }
  })

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try {
      localStorage.setItem('vv.theme', theme)
    } catch {}
  }, [theme])

  const toggle = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))
  return [theme, toggle]
}

function useUtcClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  const hh = String(now.getUTCHours()).padStart(2, '0')
  const mm = String(now.getUTCMinutes()).padStart(2, '0')
  const ss = String(now.getUTCSeconds()).padStart(2, '0')
  return `${hh}:${mm}:${ss} UTC`
}

function useHashRoute() {
  const read = () => window.location.hash || ''
  const [hash, setHash] = useState(read)
  useEffect(() => {
    const onChange = () => setHash(read())
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return hash
}

function StatusBar({ theme, onToggleTheme, mode }) {
  const time = useUtcClock()
  return (
    <div className="statusbar" role="banner">
      <div className="left">
        <span className="dot" />
        online · {profile.location}
      </div>
      <div className="mid">
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>{time}</span>
        <span style={{ margin: '0 10px', color: 'var(--rule)' }}>·</span>
        <span>{mode === 'post' ? 'reading view' : `last edit ${profile.lastEdit}`}</span>
      </div>
      <div className="right">
        {mode === 'post' ? (
          <a href="#">← all writing</a>
        ) : (
          <>
            <a href="#writing">writing</a>
            <a href="#about">about</a>
            <a href={profile.linkedin} target="_blank" rel="noopener">linkedin ↗</a>
          </>
        )}
        <button className="theme-toggle" onClick={onToggleTheme} aria-label="toggle theme">
          {theme === 'dark' ? '☼ light' : '☾ dark'}
        </button>
      </div>
    </div>
  )
}

function SectionLabel({ id, children }) {
  return (
    <div id={id} className="section-label">
      <span>{children}</span>
      <span className="rule" />
    </div>
  )
}

function Identity() {
  return (
    <header className="section">
      <div className="identity">
        <div className="name">
          {profile.name} <span className="caret" />
        </div>
        <div className="role">{profile.role}</div>
        <div className="tagline">
          Building engineering, systems, and search. Always{' '}
          <span className="fn">
            building
            <span className="note">— in spreadsheets, in prose, in code.</span>
          </span>
          .
        </div>
      </div>
    </header>
  )
}

function About() {
  return (
    <section className="section about">
      <SectionLabel id="about">about</SectionLabel>
      <p>
        I’m a principal engineer working on the unglamorous middle of the stack — storage,
        indexing, query planning, and the long tail of failure modes that don’t make it
        into design docs. I’ve been doing this for a while; I’m still learning a lot.
      </p>
      <p className="muted">
        This site is a place for me to write things down. Notes, half-formed essays,
        field reports from systems I’ve shipped, broken, and re-shipped. If any of it is
        useful to you, that’s a good day.
      </p>
      <dl className="kv">
        <dt>currently</dt><dd>building search infrastructure</dd>
        <dt>focus</dt><dd>distributed systems, retrieval, developer tooling</dd>
        <dt>elsewhere</dt>
        <dd>
          <a href={profile.linkedin} target="_blank" rel="noopener">linkedin</a>
        </dd>
        <dt>email</dt>
        <dd>
          <a href={`mailto:${profile.email}`}>{profile.email}</a>
        </dd>
      </dl>
    </section>
  )
}

function PostsList() {
  return (
    <section className="section">
      <SectionLabel id="writing">writing · {posts.length} posts</SectionLabel>
      <ul className="posts">
        {posts.map((p) => (
          <li key={p.slug}>
            <span className="date">{p.date}</span>
            <span className="tag">{p.tag}</span>
            <span className="title">
              <a href={`#/post/${p.slug}`}>{p.title}</a>
            </span>
            <span className="read">{p.read} →</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

function SvgCatWalk() {
  return (
    <svg className="svg-cat" viewBox="0 0 92 48" width="166" height="86" aria-hidden="true">
      <path d="M 10 22 Q 2 12 7 4" stroke="currentColor" strokeWidth="2.4" fill="none" strokeLinecap="round" />
      <rect x="10" y="14" width="50" height="18" rx="9" fill="currentColor" />
      <circle cx="66" cy="18" r="11" fill="currentColor" />
      <polygon points="57,8 62,17 64,12" fill="currentColor" />
      <polygon points="75,8 70,17 68,12" fill="currentColor" />
      <circle cx="70" cy="17" r="1.5" fill="var(--bg)" />
      <line x1="76" y1="20" x2="79" y2="19" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <g>
        <rect className="leg leg-a" x="13" y="31" width="3.5" height="12" rx="1.2" fill="currentColor" />
        <rect className="leg leg-b" x="20" y="31" width="3.5" height="12" rx="1.2" fill="currentColor" />
        <rect className="leg leg-b" x="50" y="31" width="3.5" height="12" rx="1.2" fill="currentColor" />
        <rect className="leg leg-a" x="56.5" y="31" width="3.5" height="12" rx="1.2" fill="currentColor" />
      </g>
    </svg>
  )
}

function SvgCatSit() {
  return (
    <svg className="svg-cat svg-cat-sit" viewBox="0 0 64 60" width="118" height="110" aria-hidden="true">
      <g className="tail">
        <path d="M 6 50 Q -2 30 20 36" stroke="currentColor" strokeWidth="2.6" fill="none" strokeLinecap="round" />
      </g>
      <ellipse cx="32" cy="42" rx="17" ry="15" fill="currentColor" />
      <circle cx="32" cy="22" r="12.5" fill="currentColor" />
      <polygon points="21,11 26,22 30,16" fill="currentColor" />
      <polygon points="43,11 38,22 34,16" fill="currentColor" />
      <circle className="eye" cx="28" cy="22" r="1.5" fill="var(--bg)" />
      <circle className="eye" cx="36" cy="22" r="1.5" fill="var(--bg)" />
      <path d="M 30 27 Q 32 29 34 27" stroke="var(--bg)" strokeWidth="0.9" fill="none" strokeLinecap="round" />
      <rect x="24" y="50" width="4" height="7" rx="1.6" fill="currentColor" />
      <rect x="36" y="50" width="4" height="7" rx="1.6" fill="currentColor" />
    </svg>
  )
}

function Cat() {
  const [phase, setPhase] = useState('walk')

  useEffect(() => {
    const t = setTimeout(() => setPhase('sit'), 5200)
    return () => clearTimeout(t)
  }, [])

  return (
    <div className={`cat cat-${phase}`} aria-hidden="true">
      {phase === 'walk' ? <SvgCatWalk /> : <SvgCatSit />}
    </div>
  )
}

function Footer() {
  return (
    <footer className="footer">
      <div>© {new Date().getFullYear()} {profile.name}</div>
      <div>
        <a href="#top">top ↑</a>
        <span style={{ margin: '0 10px', color: 'var(--rule)' }}>·</span>
        <a href="/feed.xml">rss</a>
      </div>
    </footer>
  )
}

function Body({ blocks }) {
  return (
    <div className="post-body">
      {blocks.map((b, i) => {
        if (b.type === 'p') return <p key={i}>{b.text}</p>
        if (b.type === 'h2') return <h2 key={i}>{b.text}</h2>
        if (b.type === 'blockquote') return <blockquote key={i}>{b.text}</blockquote>
        if (b.type === 'ul')
          return (
            <ul key={i}>
              {b.items.map((it, j) => <li key={j}>{it}</li>)}
            </ul>
          )
        if (b.type === 'pre')
          return <pre key={i}><code>{b.text}</code></pre>
        return null
      })}
    </div>
  )
}

function Post({ slug }) {
  const idx = Math.max(0, posts.findIndex((p) => p.slug === slug))
  const post = posts[idx]
  const prev = posts[idx + 1]
  const next = posts[idx - 1]
  const blocks = postBodies[post.slug] || genericBody

  useEffect(() => {
    document.title = `${post.title} — ${profile.name}`
    window.scrollTo(0, 0)
  }, [post.title])

  return (
    <main className="page" id="top">
      <a href="#" className="back-link">← back to index</a>
      <article>
        <div className="post-meta">
          <span style={{ color: 'var(--accent)' }}>{post.tag}</span>
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>{post.date}</span>
          <span>{post.read}</span>
        </div>
        <h1 className="post-title">{post.title}</h1>
        <p className="post-deck">{post.deck}</p>
        <Body blocks={blocks} />
      </article>
      <nav className="post-nav">
        <div>
          {prev && (
            <a href={`#/post/${prev.slug}`}>
              <div className="label">← older</div>
              <div>{prev.title}</div>
            </a>
          )}
        </div>
        <div className="next">
          {next && (
            <a href={`#/post/${next.slug}`}>
              <div className="label">newer →</div>
              <div>{next.title}</div>
            </a>
          )}
        </div>
      </nav>
    </main>
  )
}

function Index() {
  return (
    <main className="page" id="top">
      <Identity />
      <About />
      <PostsList />
      <Footer />
    </main>
  )
}

function parseRoute(hash) {
  const m = hash.match(/^#\/post\/(.+)$/)
  if (m) return { name: 'post', slug: decodeURIComponent(m[1]) }
  return { name: 'index' }
}

export default function App() {
  const [theme, toggleTheme] = useTheme()
  const hash = useHashRoute()
  const route = parseRoute(hash)

  return (
    <>
      <StatusBar theme={theme} onToggleTheme={toggleTheme} mode={route.name} />
      {route.name === 'post' ? <Post slug={route.slug} /> : <Index />}
      <Cat />
    </>
  )
}
