export function LogoMark({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <defs>
        <linearGradient id="ikat-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#7C74FF" />
          <stop offset="1" stopColor="#22B8CF" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill="url(#ikat-g)" />
      <path
        d="M6 12.2h20l-2.5 3.6a2.4 2.4 0 0 1-1.97 1.03H10.47a2.4 2.4 0 0 1-1.97-1.03L6 12.2z"
        fill="#fff"
      />
      <path
        d="M14.3 17.6h3.4l-1.05 7.1a.66.66 0 0 1-1.3 0l-1.05-7.1z"
        fill="#fff"
        fillOpacity=".85"
      />
    </svg>
  );
}

export function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <LogoMark />
      <span className="text-[17px] font-semibold tracking-[-0.03em]">Ikat</span>
    </div>
  );
}
