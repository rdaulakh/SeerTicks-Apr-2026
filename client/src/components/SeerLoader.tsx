import { cn } from "@/lib/utils";

interface SeerLoaderProps {
  className?: string;
  size?: "sm" | "md" | "lg" | "xl";
  showText?: boolean;
  text?: string;
}

export function SeerLoader({ 
  className, 
  size = "md", 
  showText = true,
  text = "Loading..."
}: SeerLoaderProps) {
  const sizes = {
    sm: { iconSize: 24, fontSize: "text-xs" },
    md: { iconSize: 48, fontSize: "text-sm" },
    lg: { iconSize: 72, fontSize: "text-base" },
    xl: { iconSize: 96, fontSize: "text-lg" },
  };

  const { iconSize, fontSize } = sizes[size];

  return (
    <div className={cn("flex flex-col items-center justify-center gap-3", className)}>
      <svg 
        viewBox="0 0 64 64" 
        className="seer-loader"
        width={iconSize}
        height={iconSize}
      >
        <defs>
          <linearGradient id="loaderGradient1" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#8b5cf6" />
            <stop offset="100%" stopColor="#3b82f6" />
          </linearGradient>
          <linearGradient id="loaderGradient2" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.4" />
            <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.4" />
          </linearGradient>
          <filter id="loaderGlow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="1.5" result="coloredBlur" />
            <feMerge>
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <radialGradient id="loaderCoreGradient" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#00d4ff" />
            <stop offset="100%" stopColor="#8b5cf6" />
          </radialGradient>
        </defs>
        
        {/* Background circle */}
        <circle cx="32" cy="32" r="30" fill="#0f0a1e" />
        
        {/* Outer ring - spinning */}
        <circle 
          cx="32" 
          cy="32" 
          r="24" 
          fill="none" 
          stroke="url(#loaderGradient1)" 
          strokeWidth="1.5" 
          opacity="0.6"
          className="animate-[spin_3s_linear_infinite]"
          style={{ transformOrigin: "32px 32px" }}
        />
        
        {/* Secondary ring - spinning reverse */}
        <circle 
          cx="32" 
          cy="32" 
          r="20" 
          fill="none" 
          stroke="url(#loaderGradient1)" 
          strokeWidth="0.5" 
          opacity="0.3"
          strokeDasharray="8 4"
          className="animate-[spin_2s_linear_infinite_reverse]"
          style={{ transformOrigin: "32px 32px" }}
        />
        
        {/* Eye shape */}
        <ellipse cx="32" cy="32" rx="16" ry="10" fill="url(#loaderGradient2)" filter="url(#loaderGlow)" />
        
        {/* Pupil */}
        <circle cx="32" cy="32" r="6" fill="#0f0a1e" />
        
        {/* Core - pulsing */}
        <circle 
          cx="32" 
          cy="32" 
          r="3" 
          fill="url(#loaderCoreGradient)" 
          filter="url(#loaderGlow)" 
          className="animate-pulse"
        />
        
        {/* Neural nodes - pulsing with delay */}
        <circle cx="12" cy="20" r="2" fill="#8b5cf6" className="animate-pulse" />
        <circle cx="52" cy="20" r="2" fill="#3b82f6" className="animate-pulse" style={{ animationDelay: "0.25s" }} />
        <circle cx="52" cy="44" r="2" fill="#06b6d4" className="animate-pulse" style={{ animationDelay: "0.5s" }} />
        <circle cx="12" cy="44" r="2" fill="#8b5cf6" className="animate-pulse" style={{ animationDelay: "0.75s" }} />
        
        {/* Connection lines */}
        <g opacity="0.3" stroke="url(#loaderGradient1)" strokeWidth="0.5">
          <line x1="12" y1="20" x2="32" y2="32" />
          <line x1="52" y1="20" x2="32" y2="32" />
          <line x1="52" y1="44" x2="32" y2="32" />
          <line x1="12" y1="44" x2="32" y2="32" />
        </g>
      </svg>
      
      {showText && (
        <span className={cn("text-slate-400", fontSize)}>{text}</span>
      )}
    </div>
  );
}

export default SeerLoader;
