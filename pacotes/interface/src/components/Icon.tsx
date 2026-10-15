// The icon set: Lucide (ISC license, https://lucide.dev), imported one by one so the bundle only
// carries the icons listed here. Every icon is a 24x24 stroke drawing, so they all share one weight;
// the size comes from CSS (--u based), the colour from `currentColor`.
import {
  ArrowLeft,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clapperboard,
  Clock,
  Film,
  FolderOpen,
  Gauge,
  Hash,
  Image as Picture,
  Info,
  LayoutGrid,
  LibraryBig,
  Megaphone,
  Menu,
  Palette,
  Pause,
  Play,
  Power,
  Proportions,
  RotateCcw,
  ScanLine,
  SlidersHorizontal,
  Spline,
  Timer,
  Tv,
  TriangleAlert,
  Type,
  Zap,
  type LucideIcon,
} from 'lucide-react';

const ICONS = {
  palette: Palette,
  picture: Picture,
  tube: Tv,
  intensity: Gauge,
  curve: Spline,
  scanlines: ScanLine,
  aspect: Proportions,
  calendar: CalendarDays,
  clock: Clock,
  tv: Tv,
  text: Type,
  interstitials: Clapperboard,
  power: Power,
  channel: Hash,
  grid: LayoutGrid,
  snow: Zap,
  ads: Megaphone,
  timer: Timer,
  episode: Film,
  info: Info,
  settings: SlidersHorizontal,
  book: LibraryBig,
  alert: TriangleAlert,
  folder: FolderOpen,
  restore: RotateCcw,
  menu: Menu,
  play: Play,
  pause: Pause,
  back: ArrowLeft,
  chevronLeft: ChevronLeft,
  chevronRight: ChevronRight,
  chevronUp: ChevronUp,
  chevronDown: ChevronDown,
  check: Check,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof ICONS;

export function Icon({ name, className = '' }: { name: IconName; className?: string }) {
  const Glyph = ICONS[name];
  // aria-hidden: lucide-react already sets it when there is no aria-label.
  return <Glyph className={`icon ${className}`} strokeWidth={2} aria-hidden="true" />;
}
