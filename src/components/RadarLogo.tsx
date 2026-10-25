import React from 'react';

interface RadarLogoProps {
  size?: number;
  scanning?: boolean;
  className?: string;
}

/**
 * SiteBite Official Radar Logo
 * Visual concept: Circular radar screen, central location marker, 3 concentric radar rings,
 * rotating radar scan line, and micro discovery symbols (utensils, coffee, landmark, star, pin).
 */
export const RadarLogo: React.FC<RadarLogoProps> = ({
  size = 36,
  scanning = true,
  className = '',
}) => {
  return (
    <div
      className={`relative inline-flex items-center justify-center shrink-0 select-none ${className}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <svg
        viewBox="0 0 100 100"
        className="w-full h-full overflow-visible"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Outer Radar Bezel */}
        <circle
          cx="50"
          cy="50"
          r="46"
          fill="#0B1324"
          stroke="#10B981"
          strokeWidth="2.5"
          strokeOpacity="0.65"
        />

        {/* 3 Concentric Radar Scan Rings */}
        <circle
          cx="50"
          cy="50"
          r="35"
          stroke="#10B981"
          strokeWidth="1.2"
          strokeOpacity="0.35"
          strokeDasharray="3 3"
        />
        <circle
          cx="50"
          cy="50"
          r="24"
          stroke="#10B981"
          strokeWidth="1.2"
          strokeOpacity="0.45"
        />
        <circle
          cx="50"
          cy="50"
          r="13"
          stroke="#10B981"
          strokeWidth="1.2"
          strokeOpacity="0.55"
        />

        {/* Crosshair Axis Lines */}
        <line
          x1="50"
          y1="6"
          x2="50"
          y2="94"
          stroke="#10B981"
          strokeWidth="0.8"
          strokeOpacity="0.2"
        />
        <line
          x1="6"
          y1="50"
          x2="94"
          y2="50"
          stroke="#10B981"
          strokeWidth="0.8"
          strokeOpacity="0.2"
        />

        {/* Micro Abstract Discovery Blips inside Radar Screen */}
        {/* 1. Restaurant / Fork-Spoon Blip (Top Right) */}
        <g transform="translate(67, 24)" className="animate-radar-pulse">
          <circle cx="4" cy="4" r="5.5" fill="#F59E0B" fillOpacity="0.2" />
          <circle cx="4" cy="4" r="2.6" fill="#F59E0B" />
        </g>

        {/* 2. Coffee Cup Blip (Top Left) */}
        <g transform="translate(24, 30)" className="animate-radar-pulse">
          <circle cx="4" cy="4" r="5" fill="#38BDF8" fillOpacity="0.2" />
          <rect x="1.8" y="2.2" width="4.4" height="3.8" rx="1" fill="#38BDF8" />
        </g>

        {/* 3. Attraction Star Blip (Bottom Right) */}
        <g transform="translate(64, 66)" className="animate-radar-pulse">
          <circle cx="4" cy="4" r="5.5" fill="#A855F7" fillOpacity="0.22" />
          <polygon
            points="4,1 4.9,2.9 7,3.2 5.5,4.6 5.8,6.7 4,5.7 2.2,6.7 2.5,4.6 1,3.2 3.1,2.9"
            fill="#C084FC"
          />
        </g>

        {/* 4. Secondary Pin Blip (Bottom Left) */}
        <g transform="translate(27, 68)">
          <circle cx="3.5" cy="3.5" r="2.3" fill="#34D399" />
        </g>

        {/* Rotating Radar Sweep Wedge & Line */}
        <g className={scanning ? 'animate-radar-sweep' : ''} style={{ transformOrigin: '50px 50px' }}>
          <path
            d="M50 50 L82 18 A45 45 0 0 1 95 50 Z"
            fill="url(#sitebiteRadarSweepGrad)"
          />
          <line
            x1="50"
            y1="50"
            x2="82"
            y2="18"
            stroke="#34D399"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
        </g>

        {/* Center Location Pin / Target Marker */}
        <path
          d="M50 38 C44.5 38 40 42.3 40 47.6 C40 54.2 50 62 50 62 C50 62 60 54.2 60 47.6 C60 42.3 55.5 38 50 38 Z"
          fill="#10B981"
          stroke="#0B1324"
          strokeWidth="2"
        />
        <circle cx="50" cy="47.5" r="3.5" fill="#0B1324" />

        <defs>
          <linearGradient id="sitebiteRadarSweepGrad" x1="50" y1="50" x2="90" y2="30" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#10B981" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#10B981" stopOpacity="0.02" />
          </linearGradient>
        </defs>
      </svg>
    </div>
  );
};

interface HeroRadarVisualProps {
  isScanning: boolean;
  hasCompletedScan: boolean;
  scanStageText?: string;
}

/**
 * Homepage & Loading Radar Visual Component (Section 31 & 33)
 */
export const HeroRadarVisual: React.FC<HeroRadarVisualProps> = ({
  isScanning,
  hasCompletedScan,
  scanStageText,
}) => {
  return (
    <div className="flex flex-col items-center justify-center my-4">
      <div className="relative flex items-center justify-center w-36 h-36 sm:w-44 sm:h-44">
        {/* Outer Ambient Halo */}
        <div
          className={`absolute inset-0 rounded-full border border-emerald-500/20 ${
            isScanning ? 'animate-radar-pulse' : ''
          }`}
        />
        <div className="absolute inset-3 rounded-full border border-emerald-500/15" />

        {/* Central Radar Logo */}
        <RadarLogo size={124} scanning={isScanning || !hasCompletedScan} />

        {/* Floating Micro Icons Around Radar Ring */}
        <div
          className="absolute top-2 right-4 px-2 py-0.5 rounded bg-slate-900/90 border border-slate-700/80 text-[11px] text-amber-300 font-mono-tabular shadow-sm"
          title="美食偵測"
        >
          🍜 美食
        </div>
        <div
          className="absolute bottom-4 left-1 px-2 py-0.5 rounded bg-slate-900/90 border border-slate-700/80 text-[11px] text-sky-300 font-mono-tabular shadow-sm"
          title="咖啡廳偵測"
        >
          ☕ 咖啡
        </div>
        <div
          className="absolute bottom-3 right-2 px-2 py-0.5 rounded bg-slate-900/90 border border-slate-700/80 text-[11px] text-emerald-300 font-mono-tabular shadow-sm"
          title="景點偵測"
        >
          📸 景點
        </div>
      </div>

      {/* Status Readout */}
      <div className="mt-2 flex items-center gap-2 text-xs font-mono-tabular text-emerald-400">
        <span
          className={`w-2 h-2 rounded-full ${
            isScanning
              ? 'bg-emerald-400 animate-radar-pulse'
              : hasCompletedScan
              ? 'bg-emerald-400'
              : 'bg-emerald-500/70'
          }`}
        />
        <span>
          {isScanning
            ? scanStageText || '正在掃描附近地點…'
            : hasCompletedScan
            ? '雷達掃描完成'
            : 'SiteBite 地點雷達 · 待命掃描中'}
        </span>
      </div>
    </div>
  );
};
