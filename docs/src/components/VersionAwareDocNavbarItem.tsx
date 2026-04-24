import React from 'react';
import {useLocation} from '@docusaurus/router';
import {useLayoutDoc} from '@docusaurus/plugin-content-docs/client';
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
  docsPluginId,
  label,
  ...props
}: Props): React.JSX.Element | null {
  const location = useLocation();
  const doc = useLayoutDoc(docId, docsPluginId);

  if (doc === null) {
    return null;
  }

  return (
    <DefaultNavbarItem
      {...props}
      exact={false}
      isActive={() =>
        activeBaseRegex
          ? new RegExp(activeBaseRegex).test(location.pathname)
          : location.pathname === doc.path
      }
      label={label ?? doc.id}
      to={doc.path}
    />
  );
}
