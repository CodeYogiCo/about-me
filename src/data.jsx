export const profile = {
  name: 'Vishal Vaibhav',
  role: 'principal engineer · systems & search',
  location: 'bengaluru',
  email: 'defvishal@gmail.com',
  linkedin: 'https://www.linkedin.com/in/vishal-vaibhav-29b25328/',
  lastEdit: '2026-04-22',
}

export const posts = [
  {
    slug: 'designing-for-search-at-scale',
    date: '2026-04-22',
    tag: 'systems',
    title: 'Designing for search at scale: notes from the trenches',
    read: '12 min',
    deck: 'What I keep relearning about index layout, query planning, and the cost of being clever.',
  },
  {
    slug: 'the-quiet-art-of-capacity-planning',
    date: '2026-03-14',
    tag: 'ops',
    title: 'The quiet art of capacity planning',
    read: '8 min',
    deck: 'Numbers on a napkin still beat dashboards most days.',
  },
  {
    slug: 'writing-systems-for-the-next-engineer',
    date: '2026-02-02',
    tag: 'craft',
    title: 'Writing systems for the next engineer',
    read: '6 min',
    deck: 'The code you leave behind is a letter. Make it readable.',
  },
  {
    slug: 'vector-search-without-the-magic',
    date: '2025-12-09',
    tag: 'search',
    title: 'Vector search without the magic',
    read: '14 min',
    deck: 'An honest walk through ANN, recall trade-offs, and where intuition fails.',
  },
  {
    slug: 'on-being-a-principal-engineer',
    date: '2025-10-28',
    tag: 'career',
    title: 'On being a principal engineer (and not a bottleneck)',
    read: '9 min',
    deck: 'Influence is a budget. Spend it on the things only you can do.',
  },
  {
    slug: 'five-databases-in-five-years',
    date: '2025-09-03',
    tag: 'systems',
    title: "Five databases in five years, and what I'd choose tomorrow",
    read: '11 min',
    deck: 'A field report from someone who has migrated more than he should have.',
  },
  {
    slug: 'the-cost-of-a-good-abstraction',
    date: '2025-07-19',
    tag: 'craft',
    title: 'The cost of a good abstraction',
    read: '7 min',
    deck: 'Abstractions are loans. Pay attention to the interest rate.',
  },
  {
    slug: 'always-be-building',
    date: '2025-05-30',
    tag: 'notes',
    title: 'Always be building',
    read: '4 min',
    deck: 'Why I keep a notebook of unfinished systems, and what they taught me.',
  },
]

export const postBodies = {
  'designing-for-search-at-scale': [
    { type: 'p', text: "I’ve spent most of the last decade thinking about search. The job is older than I am, the literature is enormous, and yet every system I’ve built has surprised me at least once. The thing that keeps surprising me is how much of search is not algorithms. It’s schema. It’s capacity. It’s the reluctance of the world to fit into clean abstractions." },
    { type: 'p', text: "What follows is a tour of the lessons I keep relearning — the ones I’d tell a younger version of myself, if he’d listen." },
    { type: 'h2', text: 'indexing is half the system' },
    { type: 'p', text: "The query is the part everyone shows you. The index is the part you live with. A good index lets you write boring queries and still answer in milliseconds; a bad index forces every layer above it into heroics." },
    { type: 'p', text: "When I review a search system, I look at the index first. How is it laid out on disk? What does a single segment cost to load? How are deletes represented? What does the merge schedule look like under steady-state write pressure? You can usually tell within ten minutes whether the system was designed by someone who’s been on-call for it." },
    { type: 'blockquote', text: 'An index is a contract with your future self about which questions are cheap.' },
    { type: 'h2', text: 'the cost of being clever' },
    { type: 'p', text: "Every clever optimization is a tax on the next person who reads the code. Sometimes the tax is worth it — a 10x latency win on the hot path is a real thing. But I’ve shipped “clever” ranking tricks that I, personally, could not explain six months later. That’s a smell." },
    { type: 'p', text: "My current rule: if I can’t draw the optimization on a whiteboard in two minutes, it doesn’t go in." },
    { type: 'h2', text: 'queries lie' },
    { type: 'p', text: "Users don’t type what they mean. They type a fragment of what they mean, then look at the results to figure out what they actually wanted. Search is a conversation, not a function call." },
    { type: 'p', text: "The implication is that latency matters more than you think. If the system answers in 30ms, the user can iterate four times in the time it takes to read this paragraph. If it answers in 800ms, they’ll give up." },
    { type: 'h2', text: "what i’d do tomorrow" },
    {
      type: 'ul',
      items: [
        'Make the index format boring. Boring is debuggable.',
        'Build the offline evaluation harness before the ranker.',
        'Spend a full week reading query logs before changing anything.',
        'Write down the failure mode of every component before shipping it.',
      ],
    },
    { type: 'p', text: "None of this is novel. All of it is hard. That’s the job." },
  ],
}

export const genericBody = [
  { type: 'p', text: "This post is a placeholder — the full draft is still in my notebook. I’m publishing the index first and filling these in over the next few weeks." },
  { type: 'p', text: "If you want to be nudged when it’s ready, the best signal is to watch this page; I don’t do a newsletter yet." },
  { type: 'h2', text: 'what this will cover' },
  {
    type: 'ul',
    items: [
      'the problem, in plain language',
      'how I’ve seen people get it wrong (myself included)',
      'a small example, with numbers',
      'what I’d actually do tomorrow',
    ],
  },
  { type: 'blockquote', text: 'Writing is thinking. Publishing is editing.' },
  { type: 'p', text: '— v' },
]
