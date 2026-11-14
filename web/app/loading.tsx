import { CipherText } from "@/components/landing/CipherText";
import { Logo } from "@/components/site/Logo";
import "@/components/landing/landing.css";

/** Route-level loading screen: the wordmark and a status line that keep decrypting until the page lands. */
export default function Loading() {
  return (
    <div className="route-loading" role="status" aria-live="polite">
      <div className="route-loading-inner">
        <Logo />
        <CipherText text="Decrypting" loop speed={45} holdMs={500} />
        <span className="preloader-bar" style={{ width: 160 }}>
          <i style={{ transform: "none", animation: "fx-marquee 1.6s linear infinite", width: "300%", backgroundSize: "33.333% 100%" }} />
        </span>
      </div>
    </div>
  );
}
