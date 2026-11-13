export function MockTag({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded bg-mock-bg px-1.5 py-0.5 text-[11px] font-medium text-mock">
      {children}
    </span>
  );
}
