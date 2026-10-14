import type { ComponentType, SVGProps } from "react";

export type ShellNavIcon = ComponentType<SVGProps<SVGSVGElement>>;

export interface ShellNavItem {
  key: string;
  href: string;
  icon: ShellNavIcon;
  label: string;
  /** Render as a primary CTA button rather than a ghost nav item. */
  primary?: boolean;
  badge?: number;
}

export interface ShellNavSection {
  /** Empty string renders the items flat, with no header row. */
  heading: string;
  /** Stable id for the voice guide (nav-section-<key>). */
  sectionKey?: string;
  /** Shown on the section header when collapsible. */
  icon?: ShellNavIcon;
  /** When true the section renders as an accordion (see SidebarSection). */
  collapsible?: boolean;
  items: ShellNavItem[];
}
