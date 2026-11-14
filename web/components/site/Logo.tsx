import Image from "next/image";

/** NIXO wordmark: brand mark plus wide tracked type. */
export function Logo({ className = "", light: _light = false }: { className?: string; light?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <Image
        src="/nixo-logo.png"
        alt=""
        width={24}
        height={24}
        className="size-6 rounded-[4px]"
        priority
        aria-hidden="true"
      />
      <span className="wordmark text-[13px] text-current">NIXO</span>
    </span>
  );
}
