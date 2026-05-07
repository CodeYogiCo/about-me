import { useEffect, useState } from 'react'
import { profile, posts } from './data'

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

function StatusBar({ theme, onToggleTheme }) {
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
        <span>last edit {profile.lastEdit}</span>
      </div>
      <div className="right">
        <a href="#writing">writing</a>
        <a href="#about">about</a>
        <a href={profile.linkedin} target="_blank" rel="noopener">linkedin ↗</a>
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

export default function App() {
  const [theme, toggleTheme] = useTheme()
  return (
    <>
      <StatusBar theme={theme} onToggleTheme={toggleTheme} />
      <main className="page" id="top">
        <Identity />
        <About />
        <PostsList />
        <Footer />
      </main>
    </>
  )
}
