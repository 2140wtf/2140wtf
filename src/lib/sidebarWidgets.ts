import type { ComponentType } from 'react';
import {
  TrendingUp,
  Flame,
  SmilePlus,
  Camera,
  Music,
  CalendarDays,
  ScrollText,
  BarChart3,
  Cat,
  Navigation,
  Newspaper,
} from 'lucide-react';
import { WikipediaIcon } from '@/components/icons/WikipediaIcon';
import type { WidgetConfig } from '@/contexts/AppContext';

// ── Types ─────────────────────────────────────────────────────────────────────

type IconComponent = ComponentType<{ className?: string }>;

/** Metadata for a widget type that can be added to the right sidebar. */
export interface WidgetDefinition {
  /** Unique identifier matching WidgetConfig.id */
  id: string;
  /** Display label shown in the widget header and picker. */
  label: string;
  /** Short description for the widget picker. */
  description: string;
  /** Icon component for the widget header and picker. */
  icon: IconComponent;
  /** Default height in pixels. */
  defaultHeight: number;
  /** Minimum height in pixels. */
  minHeight: number;
  /** Maximum height in pixels. */
  maxHeight: number;
  /** Category for grouping in the picker. */
  category: 'personal' | 'content' | 'discovery';
  /** Optional internal route the header links to. */
  href?: string;
  /** When true, the widget uses a fixed height instead of max-height, allowing internal flex layouts to fill the container. */
  fillHeight?: boolean;
}

// ── Registry ──────────────────────────────────────────────────────────────────

/** All available widget definitions. */
export const WIDGET_DEFINITIONS: WidgetDefinition[] = [
  // Discovery
  {
    id: 'trends',
    label: 'Trending',
    description: 'Top trending hashtags with sparkline charts',
    icon: TrendingUp,
    defaultHeight: 320,
    minHeight: 200,
    maxHeight: 600,
    category: 'discovery',
    href: '/trends',
  },
  {
    id: 'hot-posts',
    label: 'Hot Posts',
    description: 'Top posts from the Hot feed',
    icon: Flame,
    defaultHeight: 350,
    minHeight: 200,
    maxHeight: 600,
    category: 'discovery',
    href: '/trends',
  },
  {
    id: 'stacker-news',
    label: 'Stacker News',
    description: 'Hot posts from Stacker News',
    icon: Newspaper,
    defaultHeight: 320,
    minHeight: 200,
    maxHeight: 600,
    category: 'discovery',
    href: 'https://stacker.news/',
  },
  {
    id: 'wikipedia',
    label: 'Wikipedia',
    description: "Today's featured article from Wikipedia",
    icon: WikipediaIcon,
    defaultHeight: 350,
    minHeight: 200,
    maxHeight: 600,
    category: 'discovery',
    href: '/wikipedia',
  },
  {
    id: 'nostr-clients',
    label: 'Nostr Clients',
    description: 'Distinct authors per client over the last 30 days',
    icon: BarChart3,
    defaultHeight: 300,
    minHeight: 200,
    maxHeight: 500,
    category: 'discovery',
    href: '/trends',
  },
  {
    id: 'prediction-markets',
    label: '₿AO MARKETS',
    description: 'Kind 38000 prediction markets from ₿AO',
    icon: BarChart3,
    defaultHeight: 360,
    minHeight: 250,
    maxHeight: 650,
    category: 'discovery',
    href: '/prediction-markets',
  },
  {
    id: 'roadstr',
    label: 'Roadstr',
    description: 'Nearby road event reports with quick confirmations',
    icon: Navigation,
    defaultHeight: 360,
    minHeight: 260,
    maxHeight: 700,
    category: 'discovery',
    href: '/roadstr',
  },

  // Personal
  {
    id: 'status',
    label: 'Status',
    description: 'Your current status, editable inline',
    icon: SmilePlus,
    defaultHeight: 80,
    minHeight: 60,
    maxHeight: 120,
    category: 'personal',
    href: '/profile',
  },
  {
    id: 'pets',
    label: 'NOSTR PETS',
    description: 'Your NOSTR PETS companion, quick actions, and daily bounties',
    icon: Cat,
    defaultHeight: 360,
    minHeight: 250,
    maxHeight: 700,
    category: 'personal',
    href: '/pets',
  },
  // Content feeds
  {
    id: 'feed:photos',
    label: 'Photos',
    description: 'Recent photos from your feed',
    icon: Camera,
    defaultHeight: 400,
    minHeight: 250,
    maxHeight: 700,
    category: 'content',
    href: '/photos',
  },
  {
    id: 'feed:music',
    label: 'Music',
    description: 'Music tracks from your feed',
    icon: Music,
    defaultHeight: 350,
    minHeight: 250,
    maxHeight: 700,
    category: 'content',
    href: '/music',
  },
  {
    id: 'feed:articles',
    label: 'Articles',
    description: 'Long-form articles from your feed',
    icon: ScrollText,
    defaultHeight: 350,
    minHeight: 250,
    maxHeight: 700,
    category: 'content',
    href: '/articles',
  },
  {
    id: 'feed:events',
    label: 'Events',
    description: 'Upcoming calendar events',
    icon: CalendarDays,
    defaultHeight: 300,
    minHeight: 200,
    maxHeight: 600,
    category: 'content',
    href: '/events',
  },

];

/** Pre-built Map for O(1) widget definition lookup. */
const WIDGET_MAP = new Map(WIDGET_DEFINITIONS.map((w) => [w.id, w]));

/** Lookup a widget definition by ID. */
export function getWidgetDefinition(id: string): WidgetDefinition | undefined {
  return WIDGET_MAP.get(id);
}

/** Default widgets shown in the right sidebar for new users. */
export const DEFAULT_SIDEBAR_WIDGETS: WidgetConfig[] = [
  { id: 'stacker-news' },
  { id: 'pets' },
  { id: 'prediction-markets' },
  { id: 'trends' },
];

/** Bump this to reset existing users' right-sidebar widgets to the default. */
export const SIDEBAR_WIDGETS_VERSION = 6;

/** Category labels for display in the picker. */
export const WIDGET_CATEGORIES: Record<string, string> = {
  personal: 'Personal',
  content: 'Content',
  discovery: 'Discovery',
};
