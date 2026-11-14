import { SiteNav, SiteFooter } from "@/components/site/SiteNav";

/** Public pages (exchange view): site header and footer, no wallet needed. */
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteNav />
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 pt-24 pb-12 sm:px-6 sm:pt-28">{children}</main>
      <SiteFooter />
    </>
  );
}
