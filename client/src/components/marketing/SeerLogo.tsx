import { cn } from "@/lib/utils";

interface SeerLogoProps {
  className?: string;
  size?: "sm" | "md" | "lg" | "xl";
  showText?: boolean;
  animated?: boolean;
}

export function SeerLogo({ 
  className, 
  size = "md", 
  showText = true,
  animated = true 
}: SeerLogoProps) {
  const sizes = {
    sm: { width: 120, height: 48, iconSize: 24 },
    md: { width: 160, height: 64, iconSize: 32 },
    lg: { width: 200, height: 80, iconSize: 40 },
    xl: { width: 280, height: 112, iconSize: 56 },
  };

  const { width, height, iconSize } = sizes[size];
  const centerX = iconSize;
  const centerY = height / 2;

  return (
    <svg 
      viewBox={`0 0 ${width} ${height}`} 
      className={cn("logo", className)}
      width={width}
      height={height}
    >
      <defs>
        {/* Main gradient for eye */}
        <linearGradient id="seerGradient1" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#8b5cf6" />
          <stop offset="100%" stopColor="#3b82f6" />
        </linearGradient>
        
        {/* Eye fill gradient */}
        <linearGradient id="seerGradient2" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.3" />
        </linearGradient>
        
        {/* Text gradient */}
        <linearGradient id="seerTextGradient" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="100%" stopColor="#a78bfa" />
        </linearGradient>
        
        {/* Glow filter */}
        <filter id="seerGlow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2" result="coloredBlur" />
          <feMerge>
            <feMergeNode in="coloredBlur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        
        {/* Pulse animation for core */}
        <radialGradient id="seerCoreGradient" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#00d4ff" />
          <stop offset="100%" stopColor="#8b5cf6" />
        </radialGradient>
      </defs>
      
      {/* Outer ring with data nodes */}
      <circle 
        cx={centerX} 
        cy={centerY} 
        r={iconSize * 0.75} 
        fill="none" 
        stroke="url(#seerGradient1)" 
        strokeWidth="1.5" 
        opacity="0.6"
        className={animated ? "animate-[spin_20s_linear_infinite]" : ""}
        style={{ transformOrigin: `${centerX}px ${centerY}px` }}
      />
      
      {/* Secondary ring */}
      <circle 
        cx={centerX} 
        cy={centerY} 
        r={iconSize * 0.6} 
        fill="none" 
        stroke="url(#seerGradient1)" 
        strokeWidth="0.5" 
        opacity="0.3"
        strokeDasharray="4 4"
        className={animated ? "animate-[spin_15s_linear_infinite_reverse]" : ""}
        style={{ transformOrigin: `${centerX}px ${centerY}px` }}
      />
      
      {/* Inner eye shape */}
      <ellipse 
        cx={centerX} 
        cy={centerY} 
        rx={iconSize * 0.5} 
        ry={iconSize * 0.3} 
        fill="url(#seerGradient2)"
        filter="url(#seerGlow)"
      />
      
      {/* Pupil outer */}
      <circle 
        cx={centerX} 
        cy={centerY} 
        r={iconSize * 0.2} 
        fill="#0f0a1e"
      />
      
      {/* AI Core - pulsing center */}
      <circle 
        cx={centerX} 
        cy={centerY} 
        r={iconSize * 0.1} 
        fill="url(#seerCoreGradient)"
        filter="url(#seerGlow)"
        className={animated ? "animate-pulse" : ""}
      />
      
      {/* Data connection lines */}
      <g opacity="0.4" stroke="url(#seerGradient1)" strokeWidth="0.75">
        <line x1={centerX - iconSize * 0.6} y1={centerY - iconSize * 0.4} x2={centerX} y2={centerY} />
        <line x1={centerX + iconSize * 0.6} y1={centerY - iconSize * 0.4} x2={centerX} y2={centerY} />
        <line x1={centerX + iconSize * 0.6} y1={centerY + iconSize * 0.4} x2={centerX} y2={centerY} />
        <line x1={centerX - iconSize * 0.6} y1={centerY + iconSize * 0.4} x2={centerX} y2={centerY} />
      </g>
      
      {/* Neural nodes */}
      <g filter="url(#seerGlow)">
        <circle 
          cx={centerX - iconSize * 0.6} 
          cy={centerY - iconSize * 0.4} 
          r={iconSize * 0.05} 
          fill="#8b5cf6"
          className={animated ? "animate-pulse" : ""}
        />
        <circle 
          cx={centerX + iconSize * 0.6} 
          cy={centerY - iconSize * 0.4} 
          r={iconSize * 0.05} 
          fill="#3b82f6"
          className={animated ? "animate-pulse" : ""}
          style={{ animationDelay: "0.5s" }}
        />
        <circle 
          cx={centerX + iconSize * 0.6} 
          cy={centerY + iconSize * 0.4} 
          r={iconSize * 0.05} 
          fill="#06b6d4"
          className={animated ? "animate-pulse" : ""}
          style={{ animationDelay: "1s" }}
        />
        <circle 
          cx={centerX - iconSize * 0.6} 
          cy={centerY + iconSize * 0.4} 
          r={iconSize * 0.05} 
          fill="#8b5cf6"
          className={animated ? "animate-pulse" : ""}
          style={{ animationDelay: "1.5s" }}
        />
      </g>
      
      {/* Company name */}
      {showText && (
        <g>
          <text 
            x={centerX * 2.2} 
            y={centerY - height * 0.05} 
            fontFamily="Orbitron, monospace" 
            fontSize={iconSize * 0.6} 
            fontWeight="700" 
            fill="url(#seerTextGradient)"
          >
            SEER
          </text>
          <text 
            x={centerX * 2.2} 
            y={centerY + height * 0.15} 
            fontFamily="Inter, sans-serif" 
            fontSize={iconSize * 0.2} 
            fontWeight="400" 
            fill="#64748b" 
            letterSpacing="2px"
          >
            AI TRADING
          </text>
        </g>
      )}
    </svg>
  );
}

// Icon-only version for favicon/small spaces
export function SeerIcon({ className, size = 32 }: { className?: string; size?: number }) {
  return (
    <svg 
      viewBox="0 0 64 64" 
      className={cn("seer-icon", className)}
      width={size}
      height={size}
    >
      <defs>
        <linearGradient id="iconGradient1" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#8b5cf6" />
          <stop offset="100%" stopColor="#3b82f6" />
        </linearGradient>
        <linearGradient id="iconGradient2" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.4" />
          <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.4" />
        </linearGradient>
        <filter id="iconGlow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="1.5" result="coloredBlur" />
          <feMerge>
            <feMergeNode in="coloredBlur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      
      {/* Background circle */}
      <circle cx="32" cy="32" r="30" fill="#0f0a1e" />
      
      {/* Outer ring */}
      <circle cx="32" cy="32" r="24" fill="none" stroke="url(#iconGradient1)" strokeWidth="1.5" opacity="0.6" />
      
      {/* Eye shape */}
      <ellipse cx="32" cy="32" rx="16" ry="10" fill="url(#iconGradient2)" filter="url(#iconGlow)" />
      
      {/* Pupil */}
      <circle cx="32" cy="32" r="6" fill="#0f0a1e" />
      
      {/* Core */}
      <circle cx="32" cy="32" r="3" fill="#00d4ff" filter="url(#iconGlow)" className="animate-pulse" />
      
      {/* Neural nodes */}
      <circle cx="12" cy="20" r="2" fill="#8b5cf6" className="animate-pulse" />
      <circle cx="52" cy="20" r="2" fill="#3b82f6" className="animate-pulse" />
      <circle cx="52" cy="44" r="2" fill="#06b6d4" className="animate-pulse" />
      <circle cx="12" cy="44" r="2" fill="#8b5cf6" className="animate-pulse" />
      
      {/* Connection lines */}
      <g opacity="0.3" stroke="url(#iconGradient1)" strokeWidth="0.5">
        <line x1="12" y1="20" x2="32" y2="32" />
        <line x1="52" y1="20" x2="32" y2="32" />
        <line x1="52" y1="44" x2="32" y2="32" />
        <line x1="12" y1="44" x2="32" y2="32" />
      </g>
    </svg>
  );
}

export default SeerLogo;
