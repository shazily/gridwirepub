import { HelpCircle } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type HelpTipProps = {
  title?: string;
  children: React.ReactNode;
  className?: string;
  learnMoreHref?: string;
};

/** Contextual ? icon with guidance for complex admin settings. */
export function HelpTip({ title, children, className, learnMoreHref }: HelpTipProps) {
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className={cn(
              "inline-flex shrink-0 rounded-full text-muted-foreground transition-colors hover:text-primary",
              className,
            )}
            aria-label={title ?? "Help"}
          >
            <HelpCircle className="h-4 w-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-sm text-xs leading-relaxed">
          {title && <p className="mb-1 font-semibold text-foreground">{title}</p>}
          <div className="text-muted-foreground">{children}</div>
          {learnMoreHref && (
            <a href={learnMoreHref} className="mt-2 block text-primary underline-offset-2 hover:underline">
              Read more in Help →
            </a>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
