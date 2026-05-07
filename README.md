# codeyogico.github.io

Personal site for Vishal Vaibhav. Live at https://codeyogico.github.io/

Vite + React, posts in markdown. Hosted on GitHub Pages, auto-deployed
on every push to `main` via `.github/workflows/deploy.yml`.

## Local dev

```sh
npm install
npm run dev      # http://localhost:5173
```

## Build

```sh
npm run build    # outputs to dist/
npm run preview  # preview the production build locally
```

## Adding a post

Drop a markdown file into `src/posts/`. The filename (without `.md`)
becomes the URL slug. Frontmatter:

```markdown
---
date: 2026-04-22
tag: systems
title: My post title
read: 8 min
deck: A short subtitle shown under the title.
hidden: true        # optional — excludes from index but URL still works
---

Body in markdown. Standard syntax: `## headings`, `- lists`,
`> blockquotes`, `**bold**`, etc.
```

Posts are sorted by `date` descending in the index list.

## Editing identity

`src/data.jsx` holds name, role, email, linkedin, location, lastEdit.
