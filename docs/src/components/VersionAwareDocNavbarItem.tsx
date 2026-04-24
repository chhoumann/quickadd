import React from 'react';
import {useLocation} from '@docusaurus/router';
import DefaultNavbarItem from '@theme/NavbarItem/DefaultNavbarItem';

type Props = {
  activeBaseRegex?: string;
  docId: string;
  docsPluginId?: string;
  label?: string;
  mobile?: boolean;
  position?: 'left' | 'right';
};

export default function VersionAwareDocNavbarItem({
  activeBaseRegex,
  docId,
  label,
  ...props
}: Props): React.JSX.Element | null {
  const location = useLocation();
  const path = getVersionedDocPath(location.pathname, docId);

  return (
    <DefaultNavbarItem
      {...props}
      exact={false}
      isActive={() =>
        activeBaseRegex
          ? new RegExp(activeBaseRegex).test(location.pathname)
          : location.pathname === path
      }
      label={label ?? docId}
      to={path}
    />
  );
}

function getVersionedDocPath(pathname: string, docId: string): string {
  const versionMatch = pathname.match(/^\/docs\/(next|[0-9.]+)(?=\/|$)/);
  const docsBase = versionMatch ? `/docs/${versionMatch[1]}` : '/docs';

  if (docId === 'index') {
    return `${docsBase}/`;
  }

  return `${docsBase}/${docId}`;
}
