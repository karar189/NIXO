export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <svg
        width="26"
        height="26"
        viewBox="0 0 32 32"
        fill="none"
        aria-hidden="true"
      >
        <rect width="32" height="32" rx="8" fill="var(--surface-2)" />
        <path
          d="M7 23a9 9 0 0 1 18 0"
          stroke="var(--accent)"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        <path
          d="M11.5 23a4.5 4.5 0 0 1 9 0"
          stroke="var(--accent-2)"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        <circle cx="16" cy="9" r="2" fill="var(--accent)" />
      </svg>
      <span className="text-[17px] font-semibold tracking-tight">NearArc</span>
    </span>
  );
}
