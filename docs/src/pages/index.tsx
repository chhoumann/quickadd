import React from 'react';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';
import Heading from '@theme/Heading';

import styles from './index.module.css';

// ──────────────────────────────────────────────────────────
// Icons (Lucide-style, 24×24, currentColor stroke)
// ──────────────────────────────────────────────────────────

type IconProps = React.SVGProps<SVGSVGElement>;

const Svg = ({children, ...props}: React.PropsWithChildren<IconProps>) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.75"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    {...props}>
    {children}
  </svg>
);

const ZapIcon = () => (
  <Svg>
    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
  </Svg>
);

const FileTextIcon = () => (
  <Svg>
    <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
    <path d="M14 2v4a2 2 0 0 0 2 2h4" />
    <path d="M10 9H8" />
    <path d="M16 13H8" />
    <path d="M16 17H8" />
  </Svg>
);

const WorkflowIcon = () => (
  <Svg>
    <rect width="8" height="8" x="3" y="3" rx="2" />
    <path d="M7 11v4a2 2 0 0 0 2 2h4" />
    <rect width="8" height="8" x="13" y="13" rx="2" />
  </Svg>
);

const SparklesIcon = () => (
  <Svg>
    <path d="M9.94 15.5A2 2 0 0 0 8.5 14.06l-6.13-1.58a.5.5 0 0 1 0-.96L8.5 9.94A2 2 0 0 0 9.94 8.5l1.58-6.13a.5.5 0 0 1 .96 0L14.06 8.5A2 2 0 0 0 15.5 9.94l6.13 1.58a.5.5 0 0 1 0 .96L15.5 14.06a2 2 0 0 0-1.44 1.44l-1.58 6.13a.5.5 0 0 1-.96 0z" />
    <path d="M20 3v4" />
    <path d="M22 5h-4" />
    <path d="M4 17v2" />
    <path d="M5 18H3" />
  </Svg>
);

const FolderTreeIcon = () => (
  <Svg>
    <path d="M20 10a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-2.5a1 1 0 0 1-.8-.4l-.9-1.2A1 1 0 0 0 15 3h-2a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1Z" />
    <path d="M20 21a1 1 0 0 0 1-1v-3a1 1 0 0 0-1-1h-2.9a1 1 0 0 1-.88-.55l-.42-.85a1 1 0 0 0-.92-.6H13a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1Z" />
    <path d="M3 5a2 2 0 0 0 2 2h3" />
    <path d="M3 3v13a2 2 0 0 0 2 2h3" />
  </Svg>
);

const RocketIcon = () => (
  <Svg>
    <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
    <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
    <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" />
    <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
  </Svg>
);

const BookIcon = () => (
  <Svg>
    <path d="M12 7v14" />
    <path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z" />
  </Svg>
);

const PenIcon = () => (
  <Svg>
    <path d="M12 20h9" />
    <path d="M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.854z" />
  </Svg>
);

const FilmIcon = () => (
  <Svg>
    <rect width="18" height="18" x="3" y="3" rx="2" />
    <path d="M7 3v18" />
    <path d="M3 7.5h4" />
    <path d="M3 12h18" />
    <path d="M3 16.5h4" />
    <path d="M17 3v18" />
    <path d="M17 7.5h4" />
    <path d="M17 16.5h4" />
  </Svg>
);

const ListChecksIcon = () => (
  <Svg>
    <path d="m3 17 2 2 4-4" />
    <path d="m3 7 2 2 4-4" />
    <path d="M13 6h8" />
    <path d="M13 12h8" />
    <path d="M13 18h8" />
  </Svg>
);

// ──────────────────────────────────────────────────────────
// Content
// ──────────────────────────────────────────────────────────

type Feature = {
  title: string;
  icon: React.JSX.Element;
  description: string;
};

const features: Feature[] = [
  {
    title: 'Lightning-fast capture',
    icon: <ZapIcon />,
    description:
      'Hit one hotkey and drop content into any note. No file picker, no friction — just type and it lands where you want.',
  },
  {
    title: 'Powerful templates',
    icon: <FileTextIcon />,
    description:
      'Compose notes with dynamic variables, dates, and inline prompts. Plays well with Obsidian Templates and Templater.',
  },
  {
    title: 'Macro automations',
    icon: <WorkflowIcon />,
    description:
      'Chain choices and user scripts into one-key workflows. Scrape metadata, update a log, open a file — all in sequence.',
  },
  {
    title: 'Built-in AI',
    icon: <SparklesIcon />,
    description:
      'Talk to OpenAI, Anthropic, or a local model. Summarize, expand, and rewrite notes without leaving Obsidian.',
  },
  {
    title: 'Organize with Multis',
    icon: <FolderTreeIcon />,
    description:
      'Group related choices into nested folders. Build your own menu for your own workflows.',
  },
  {
    title: 'Actively maintained',
    icon: <RocketIcon />,
    description:
      'Regular updates shaped by real community feedback. Battle-tested in thousands of vaults.',
  },
];

type Example = {
  title: string;
  icon: React.JSX.Element;
  description: string;
  href: string;
};

const examples: Example[] = [
  {
    title: 'Book database',
    icon: <BookIcon />,
    description:
      'Fetch metadata from APIs and generate rich book notes. Track ratings, quotes, and reading progress with one command.',
    href: '/docs/Examples/Macro_BookFinder',
  },
  {
    title: 'Daily journaling',
    icon: <PenIcon />,
    description:
      'Capture entries with timestamps, weather, and mood. Never miss a day with guided prompts.',
    href: '/docs/Examples/Capture_AddJournalEntry',
  },
  {
    title: 'Media tracker',
    icon: <FilmIcon />,
    description:
      'Log movies and shows with auto-fetched metadata. Curate watchlists and reviews without friction.',
    href: '/docs/Examples/Macro_MovieAndSeriesScript',
  },
  {
    title: 'Task management',
    icon: <ListChecksIcon />,
    description:
      'Send tasks to Todoist, populate Kanban boards, and run projects. Make Obsidian your productivity hub.',
    href: '/docs/Examples/Capture_AddTaskToKanbanBoard',
  },
];

const steps = [
  {
    title: 'Install',
    description:
      "Find QuickAdd in Obsidian's Community Plugins browser and enable it.",
  },
  {
    title: 'Create a choice',
    description:
      'Open settings and add a Template, Capture, or Macro — or combine them into a Multi.',
  },
  {
    title: 'Hit your hotkey',
    description:
      'Trigger QuickAdd with ⌘/Ctrl-P and pick your choice. That\u2019s it.',
  },
];

// ──────────────────────────────────────────────────────────
// Sections
// ──────────────────────────────────────────────────────────

function Hero(): React.JSX.Element {
  return (
    <header className={styles.hero}>
      <div className={styles.container}>
        <img
          src="/img/quickadd-icon.png"
          alt=""
          className={styles.heroLogo}
          aria-hidden="true"
        />
        <div className={styles.eyebrow}>For Obsidian</div>
        <Heading as="h1" className={styles.heroTitle}>
          Supercharge Obsidian with one hotkey.
        </Heading>
        <p className={styles.heroSubtitle}>
          Templates, captures, macros, and AI — bound to a single command.
          QuickAdd turns repetitive note-taking tasks into keystrokes.
        </p>
        <div className={styles.heroActions}>
          <Link className={styles.buttonPrimary} to="/docs/">
            Read the docs
          </Link>
          <Link
            className={styles.buttonSecondary}
            to="https://obsidian.md/plugins?id=quickadd">
            Install from Obsidian →
          </Link>
        </div>
        <div className={styles.heroChip} aria-hidden="true">
          <kbd className={styles.kbd}>⌘</kbd>
          <kbd className={styles.kbd}>P</kbd>
          <span className={styles.chipArrow}>→</span>
          <span className={styles.chipLabel}>QuickAdd: Run Choice</span>
        </div>
      </div>
    </header>
  );
}

function Features(): React.JSX.Element {
  return (
    <section className={styles.section}>
      <div className={styles.container}>
        <div className={styles.sectionHead}>
          <div className={styles.eyebrow}>Features</div>
          <Heading as="h2" className={styles.sectionTitle}>
            Four composable choices. Endless workflows.
          </Heading>
          <p className={styles.sectionSubtitle}>
            Templates, Captures, Macros, and Multis combine into whatever
            automation your vault needs — with AI on tap.
          </p>
        </div>
        <dl className={styles.features}>
          {features.map((f) => (
            <div className={styles.feature} key={f.title}>
              <span className={styles.featureIcon}>{f.icon}</span>
              <dt className={styles.featureTitle}>{f.title}</dt>
              <dd className={styles.featureDesc}>{f.description}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

function Examples(): React.JSX.Element {
  return (
    <section className={styles.section}>
      <div className={styles.container}>
        <div className={styles.sectionHead}>
          <div className={styles.eyebrow}>Examples</div>
          <Heading as="h2" className={styles.sectionTitle}>
            What can you build?
          </Heading>
          <p className={styles.sectionSubtitle}>
            A few things people actually ship with QuickAdd. Every example ships
            with a walkthrough.
          </p>
        </div>
        <div className={styles.examples}>
          {examples.map((e) => (
            <article className={styles.example} key={e.title}>
              <span className={styles.exampleIcon}>{e.icon}</span>
              <h3 className={styles.exampleTitle}>{e.title}</h3>
              <p className={styles.exampleDesc}>{e.description}</p>
              <Link
                className={styles.exampleLink}
                to={e.href}
                aria-label={`Learn how: ${e.title}`}>
                Learn how →
              </Link>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function QuickStart(): React.JSX.Element {
  return (
    <section className={styles.quickStart}>
      <div className={styles.container}>
        <div className={styles.sectionHead}>
          <div className={styles.eyebrow}>Get started</div>
          <Heading as="h2" className={styles.sectionTitle}>
            Up and running in three steps.
          </Heading>
        </div>
        <ol className={styles.steps} role="list">
          {steps.map((s, i) => (
            <li className={styles.step} key={s.title}>
              <span className={styles.stepNumber} aria-hidden="true">
                {String(i + 1).padStart(2, '0')}
              </span>
              <h3 className={styles.stepTitle}>{s.title}</h3>
              <p className={styles.stepDesc}>{s.description}</p>
            </li>
          ))}
        </ol>
        <div className={styles.quickStartCta}>
          <Link className={styles.buttonPrimary} to="/docs/">
            Read the documentation
          </Link>
        </div>
      </div>
    </section>
  );
}

// ──────────────────────────────────────────────────────────
// Page
// ──────────────────────────────────────────────────────────

export default function Home(): React.JSX.Element {
  const {siteConfig} = useDocusaurusContext();
  return (
    <Layout
      title="QuickAdd — Supercharge your Obsidian workflow"
      description={`${siteConfig.tagline} Templates, captures, macros, and AI, bound to one hotkey.`}>
      <div className={styles.landing}>
        <Hero />
        <main>
          <Features />
          <Examples />
          <QuickStart />
        </main>
      </div>
    </Layout>
  );
}
