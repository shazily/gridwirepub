import { cn } from "@/lib/utils";

export type BrandProps = {
  className?: string;
  platformName?: string;
  logoUrl?: string | null;
};

export function GridwireMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      className={cn("h-7 w-7", className)}
      aria-hidden="true"
    >
      <rect x="2" y="2" width="28" height="28" rx="7" className="fill-primary/15" />
      <path
        d="M8 11h16M8 16h16M8 21h16"
        stroke="currentColor"
        className="text-primary"
        strokeWidth="1.6"
        strokeLinecap="round"
        opacity="0.5"
      />
      <path
        d="M9 9v14"
        stroke="currentColor"
        className="text-primary"
        strokeWidth="1.6"
        strokeLinecap="round"
        opacity="0.5"
      />
      <path
        d="M16 7.5l8 8.5-8 8.5"
        stroke="currentColor"
        className="text-primary"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="16" cy="16" r="2.4" className="fill-primary" />
    </svg>
  );
}

export function Wordmark({ className, platformName = "Gridwire", logoUrl }: BrandProps) {
  return (
    <span className={cn("flex items-center gap-2", className)}>
      {logoUrl ? (
        <img
          src={logoUrl}
          alt=""
          className="h-8 w-8 rounded-md object-contain"
        />
      ) : (
        <GridwireMark />
      )}
      <span className="font-display text-lg font-bold tracking-tight">{platformName}</span>
    </span>
  );
}

export function PortalBrand({ className, platformName = "Gridwire", logoUrl }: BrandProps) {
  return <Wordmark className={className} platformName={platformName} logoUrl={logoUrl} />;
}
