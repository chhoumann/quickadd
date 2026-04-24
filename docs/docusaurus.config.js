// @ts-check
// Note: type annotations allow type checking and IDEs autocompletion

const {themes} = require('prism-react-renderer');
const lightCodeTheme = themes.github;
const darkCodeTheme = themes.dracula;

let docsVersions = [];
try {
  docsVersions = require('./versions.json');
} catch {
  docsVersions = [];
}

const latestStableVersion = docsVersions[0];

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: 'QuickAdd',
  tagline: 'Quickly add new pages or content to your vault.',
  url: 'https://quickadd.obsidian.guide',
  baseUrl: '/',
  onBrokenLinks: 'throw',
  onBrokenMarkdownLinks: 'warn',
  favicon: 'img/favicon.ico',

  // GitHub pages deployment config.
  // If you aren't using GitHub pages, you don't need these.
  organizationName: 'chhoumann', // Usually your GitHub org/user name.
  projectName: 'quickadd', // Usually your repo name.

  // Even if you don't use internalization, you can use this field to set useful
  // metadata like html lang. For example, if your site is Chinese, you may want
  // to replace "en" with "zh-Hans".
  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      /** @type {import('@docusaurus/preset-classic').Options} */
      ({
        docs: {
          sidebarPath: require.resolve('./sidebars.js'),
          editUrl:
            'https://github.com/chhoumann/quickadd/tree/master/docs/',
          ...(latestStableVersion ? {lastVersion: latestStableVersion} : {}),
          versions: {
            current: {
              label: 'Next 🚧',
              path: 'next',
              banner: 'unreleased',
            },
            ...(latestStableVersion
              ? {
                  [latestStableVersion]: {
                    label: latestStableVersion,
                    path: '',
                  },
                }
              : {}),
          },
        },
        blog: false,
        theme: {
          customCss: require.resolve('./src/css/custom.css'),
        },
      }),
    ],
  ],

  themeConfig:
    /** @type {import('@docusaurus/preset-classic').ThemeConfig} */
    ({
      image: 'img/quickadd-logo.png',
      navbar: {
        title: 'QuickAdd',
        logo: {
          alt: 'QuickAdd',
          src: 'img/quickadd-icon.png',
        },
        items: [
          {
            type: 'docsVersionDropdown',
            position: 'left',
            dropdownActiveClassDisabled: true,
          },
          {
            type: 'custom-versionAwareDoc',
            docId: 'index',
            position: 'left',
            label: 'Docs',
            activeBaseRegex: '^/docs/(next/|[0-9.]+/)?(?!(Advanced/APIOverview|QuickAddAPI|Examples/)).*',
          },
          {
            type: 'custom-versionAwareDoc',
            docId: 'QuickAddAPI',
            position: 'left',
            label: 'API',
            activeBaseRegex: '^/docs/(next/|[0-9.]+/)?(Advanced/APIOverview|QuickAddAPI)/?$',
          },
          {
            type: 'custom-versionAwareDoc',
            docId: 'Examples/Macro_BookFinder',
            position: 'left',
            label: 'Examples',
            activeBaseRegex: '^/docs/(next/|[0-9.]+/)?Examples/',
          },
          {
            href: 'https://github.com/chhoumann/quickadd',
            position: 'right',
            className: 'header-github-link',
            'aria-label': 'GitHub repository',
          },
        ],
      },
      footer: {
        style: 'dark',
        links: [
          {
            title: 'Docs',
            items: [
              {
                label: 'Documentation',
                to: '/docs/',
              },
            ],
          },
          {
            title: 'Community',
            items: [
              {
                label: 'Discussions',
                href: 'https://github.com/chhoumann/quickadd/discussions',
              },
            ],
          },
        ],
      },
      prism: {
        theme: lightCodeTheme,
        darkTheme: darkCodeTheme,
      },
      colorMode: {
        defaultMode: 'light',
        disableSwitch: false,
        respectPrefersColorScheme: true,
      },
    }),
    
  themes: [
    [
      require.resolve("@easyops-cn/docusaurus-search-local"),
      {
        hashed: true,
        language: ["en"],
        highlightSearchTermsOnTargetPage: true,
        explicitSearchResultPath: true,
        docsRouteBasePath: "/docs",
        indexBlog: false,
        searchBarShortcutHint: false,
      },
    ],
  ],
};

module.exports = config;
