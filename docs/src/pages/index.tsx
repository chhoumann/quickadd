import React from 'react';
import clsx from 'clsx';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';
import Heading from '@theme/Heading';

import styles from './index.module.css';

type FeatureItem = {
  title: string;
  icon: string;
  description: JSX.Element;
};

const FeatureList: FeatureItem[] = [
  {
    title: 'Lightning Fast Capture',
    icon: '⚡',
    description: (
      <>
        Capture thoughts, ideas, and information instantly. No more context switching - 
        just hit your hotkey and start typing.
      </>
    ),
  },
  {
    title: 'Powerful Templates',
    icon: '📄',
    description: (
      <>
        Create complex templates with variables, dates, and dynamic content. 
        Works seamlessly with Obsidian templates and Templater.
      </>
    ),
  },
  {
    title: 'Automation with Macros',
    icon: '🤖',
    description: (
      <>
        Build powerful automation workflows with JavaScript. Chain commands, 
        integrate with APIs, and supercharge your vault management.
      </>
    ),
  },
  {
    title: 'AI Integration',
    icon: '🧠',
    description: (
      <>
        Connect to OpenAI, Anthropic, and other AI providers. Generate content, 
        summarize notes, and enhance your knowledge management.
      </>
    ),
  },
  {
    title: 'Flexible Organization',
    icon: '📁',
    description: (
      <>
        Organize your choices into folders with Multi-Choice. Create custom 
        workflows that match your unique note-taking style.
      </>
    ),
  },
  {
    title: 'Active Development',
    icon: '🚀',
    description: (
      <>
        Regular updates, active community, and continuous improvements. 
        Your feedback shapes the future of QuickAdd.
      </>
    ),
  },
];

function Feature({title, icon, description}: FeatureItem) {
  return (
    <div className={clsx('col col--4')}>
      <div className="feature-card text--center padding--lg">
        <div className="feature-icon" style={{fontSize: '3rem'}}>{icon}</div>
        <Heading as="h3">{title}</Heading>
        <p>{description}</p>
      </div>
    </div>
  );
}

function HomepageHeader() {
  const {siteConfig} = useDocusaurusContext();
  return (
    <header className={clsx('hero', styles.heroBanner)}>
      <div className="container">
        <Heading as="h1" className="hero__title">
          QuickAdd for Obsidian
        </Heading>
        <p className="hero__subtitle" style={{fontSize: '1.3rem', maxWidth: '600px', margin: '0 auto'}}>
          {siteConfig.tagline}
        </p>
        <div className={styles.buttons}>
          <Link
            className="button hero-button hero-button--primary"
            to="/docs/">
            Get Started →
          </Link>
          <Link
            className="button button--outline hero-button"
            to="https://obsidian.md/plugins?id=quickadd">
            Install Plugin
          </Link>
        </div>
      </div>
    </header>
  );
}

function HomepageFeatures(): JSX.Element {
  return (
    <section className={styles.features}>
      <div className="container">
        <div className="row">
          {FeatureList.map((props, idx) => (
            <Feature key={idx} {...props} />
          ))}
        </div>
      </div>
    </section>
  );
}

function ExampleSection(): JSX.Element {
  return (
    <section className="section-dark padding-vert--lg">
      <div className="container">
        <Heading as="h2" className="text--center margin-bottom--lg">
          What Can You Build?
        </Heading>
        <div className="row">
          <div className="col col--6">
            <div className="feature-card">
              <h3>📚 Book Database</h3>
              <p>Automatically create book notes with metadata fetched from APIs. Add ratings, quotes, and reading progress with a single command.</p>
              <Link to="/docs/Examples/Macro_BookFinder">Learn how →</Link>
            </div>
          </div>
          <div className="col col--6">
            <div className="feature-card">
              <h3>📝 Daily Journaling</h3>
              <p>Capture journal entries with timestamps, mood tracking, and weather data. Never miss a day with automated prompts.</p>
              <Link to="/docs/Examples/Capture_AddJournalEntry">Learn how →</Link>
            </div>
          </div>
        </div>
        <div className="row margin-top--md">
          <div className="col col--6">
            <div className="feature-card">
              <h3>🎬 Media Tracker</h3>
              <p>Track movies and TV shows with automatic metadata. Create watchlists, reviews, and recommendations.</p>
              <Link to="/docs/Examples/Macro_MovieAndSeriesScript">Learn how →</Link>
            </div>
          </div>
          <div className="col col--6">
            <div className="feature-card">
              <h3>✅ Task Management</h3>
              <p>Integrate with Todoist, create Kanban boards, and manage projects. Turn Obsidian into your productivity hub.</p>
              <Link to="/docs/Examples/Capture_AddTaskToKanbanBoard">Learn how →</Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function QuickStartSection(): JSX.Element {
  return (
    <section className="padding-vert--lg">
      <div className="container">
        <Heading as="h2" className="text--center margin-bottom--lg">
          Quick Start
        </Heading>
        <div className="row">
          <div className="col col--4">
            <div className="text--center">
              <div style={{fontSize: '2rem', marginBottom: '1rem'}}>1️⃣</div>
              <h3>Install QuickAdd</h3>
              <p>Find QuickAdd in Obsidian's Community Plugins browser and enable it.</p>
            </div>
          </div>
          <div className="col col--4">
            <div className="text--center">
              <div style={{fontSize: '2rem', marginBottom: '1rem'}}>2️⃣</div>
              <h3>Create Your First Choice</h3>
              <p>Open settings and create a Template, Capture, or Macro choice.</p>
            </div>
          </div>
          <div className="col col--4">
            <div className="text--center">
              <div style={{fontSize: '2rem', marginBottom: '1rem'}}>3️⃣</div>
              <h3>Start Automating</h3>
              <p>Trigger QuickAdd with Cmd/Ctrl+P and select your choice. That's it!</p>
            </div>
          </div>
        </div>
        <div className="text--center margin-top--lg">
          <Link
            className="button button--primary button--lg hero-button hero-button--primary"
            to="/docs/">
            Read the Documentation
          </Link>
        </div>
      </div>
    </section>
  );
}

export default function Home(): JSX.Element {
  const {siteConfig} = useDocusaurusContext();
  return (
    <Layout
      title={`QuickAdd - Supercharge Your Obsidian Workflow`}
      description={`${siteConfig.tagline} Create templates, capture ideas, and automate your vault with powerful macros and AI integration.`}>
      <HomepageHeader />
      <main>
        <HomepageFeatures />
        <ExampleSection />
        <QuickStartSection />
      </main>
    </Layout>
  );
}