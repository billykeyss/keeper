// Inline SVG line-icon set — a single consistent 1.5px stroke family drawn in
// currentColor. Never emoji. viewBox 0 0 24 24, round caps/joins.

type IconProps = { size?: number; className?: string };

function svg(children: React.ReactNode, size = 20, className?: string) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

const Calendar = (p: IconProps) =>
  svg(
    <>
      <rect x="3" y="5" width="18" height="16" rx="2.5" />
      <path d="M3 9.5h18M8 3v4M16 3v4" />
    </>,
    p.size,
    p.className,
  );

const Fish = (p: IconProps) =>
  svg(
    <>
      <path d="M15.5 12c-1.9 3-5 5-8.5 5-1.4 0-2.8-.3-4-1 .9-1.2 1.4-2.5 1.4-4s-.5-2.8-1.4-4c1.2-.7 2.6-1 4-1 3.5 0 6.6 2 8.5 5z" />
      <path d="M15.5 12 21 8v8z" />
      <circle cx="7" cy="10.5" r=".7" fill="currentColor" stroke="none" />
    </>,
    p.size,
    p.className,
  );

const Ruler = (p: IconProps) =>
  svg(
    <>
      <rect x="3" y="8" width="18" height="8" rx="1.5" />
      <path d="M7 8v3M11 8v4M15 8v3M19 8v4" />
    </>,
    p.size,
    p.className,
  );

const Hook = (p: IconProps) =>
  svg(
    <>
      <path d="M16 5v6a6 6 0 0 1-12 0v-.5" />
      <path d="M4 12.5 2 10.5m2 2 2-2" />
      <circle cx="16" cy="4.2" r="1.3" />
    </>,
    p.size,
    p.className,
  );

const Clock = (p: IconProps) =>
  svg(
    <>
      <circle cx="12" cy="12" r="8.2" />
      <path d="M12 7.5V12l3 2" />
    </>,
    p.size,
    p.className,
  );

const Ban = (p: IconProps) =>
  svg(
    <>
      <circle cx="12" cy="12" r="8.2" />
      <path d="M6.2 6.2 17.8 17.8" />
    </>,
    p.size,
    p.className,
  );

const Boat = (p: IconProps) =>
  svg(
    <>
      <path d="M3 14h18l-2.2 5.2a1 1 0 0 1-.9.6H6.1a1 1 0 0 1-.9-.6z" />
      <path d="M12 3v8" />
      <path d="M12 5.5 17 11H12z" />
    </>,
    p.size,
    p.className,
  );

const Card = (p: IconProps) =>
  svg(
    <>
      <rect x="3" y="6" width="18" height="12" rx="2.5" />
      <path d="M3 10.5h18M7 14.5h5" />
    </>,
    p.size,
    p.className,
  );

const Droplet = (p: IconProps) =>
  svg(
    <path d="M12 3.5c3 3.9 5 6.4 5 8.9a5 5 0 0 1-10 0c0-2.5 2-5 5-8.9z" />,
    p.size,
    p.className,
  );

const Wave = (p: IconProps) =>
  svg(
    <>
      <path d="M3 8.5c2-2 4-2 6 0s4 2 6 0 4-2 6 0" />
      <path d="M3 14.5c2-2 4-2 6 0s4 2 6 0 4-2 6 0" />
    </>,
    p.size,
    p.className,
  );

const Info = (p: IconProps) =>
  svg(
    <>
      <circle cx="12" cy="12" r="8.2" />
      <path d="M12 11v5M12 7.7h.01" />
    </>,
    p.size,
    p.className,
  );

export const ExternalIcon = (p: IconProps) =>
  svg(
    <>
      <path d="M14 4h6v6M20 4l-8.5 8.5" />
      <path d="M18 13.5V18a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 5 18V7.5A1.5 1.5 0 0 1 6.5 6H11" />
    </>,
    p.size ?? 14,
    p.className,
  );

export const CheckIcon = (p: IconProps) =>
  svg(<path d="M5 12.5 10 17 20 6" />, p.size, p.className);

export const WarnIcon = (p: IconProps) =>
  svg(
    <>
      <path d="M12 4 21.5 20H2.5z" />
      <path d="M12 10v4.5M12 17.5h.01" />
    </>,
    p.size,
    p.className,
  );

export const RetryIcon = (p: IconProps) =>
  svg(<path d="M20 11a8 8 0 1 1-2.3-5.4M20 3.5V8h-4.5" />, p.size, p.className);

export const CloseIcon = (p: IconProps) =>
  svg(<path d="M6 6l12 12M18 6 6 18" />, p.size, p.className);

export const SearchIcon = (p: IconProps) =>
  svg(
    <>
      <circle cx="10.5" cy="10.5" r="6.2" />
      <path d="m15.3 15.3 5.2 5.2" />
    </>,
    p.size,
    p.className,
  );

// The same fish glyph used for bag-limit rule cards, exported for the mobile dock.
export const FishIcon = (p: IconProps) =>
  svg(
    <>
      <path d="M15.5 12c-1.9 3-5 5-8.5 5-1.4 0-2.8-.3-4-1 .9-1.2 1.4-2.5 1.4-4s-.5-2.8-1.4-4c1.2-.7 2.6-1 4-1 3.5 0 6.6 2 8.5 5z" />
      <path d="M15.5 12 21 8v8z" />
      <circle cx="7" cy="10.5" r=".7" fill="currentColor" stroke="none" />
    </>,
    p.size,
    p.className,
  );

export const TreesIcon = (p: IconProps) =>
  svg(
    <>
      <path d="M9 4 4 12h3l-3.5 6H15L11.5 12h3z" />
      <path d="M9 18v3.5" />
      <path d="M17.5 8.5 14.8 13h1.7l-2 4h6l-2-4h1.7z" />
      <path d="M17.5 17v3" />
    </>,
    p.size,
    p.className,
  );

export const ChatIcon = (p: IconProps) =>
  svg(
    <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7a2.5 2.5 0 0 1-2.5 2.5H9.5l-4 3.3c-.6.5-1.5.1-1.5-.7z" />,
    p.size,
    p.className,
  );

const RULE_ICONS: Record<string, (p: IconProps) => React.ReactElement> = {
  season: Calendar,
  bag: Fish,
  size_limit: Ruler,
  gear_method: Hook,
  fishing_hours: Clock,
  closure: Ban,
  vessel: Boat,
  ais: Boat,
  license: Card,
  documentation: Card,
  handling: Droplet,
  special: Info,
  definition: Info,
};

/** Icon for a regulation type. */
export function RuleIcon({ type, size, className }: { type: string } & IconProps) {
  const C = RULE_ICONS[type] ?? Info;
  return <C size={size} className={className} />;
}

/** White water-type glyph shown inside a map pin. */
export function WaterGlyph({ waterType, size, className }: { waterType: string } & IconProps) {
  const flowing = ["river", "stream", "creek"].includes(waterType);
  return flowing ? <Wave size={size} className={className} /> : <Droplet size={size} className={className} />;
}
