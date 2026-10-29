"use client";

import { usePathname } from "next/navigation";

function ReadingProgressBar() {
  return (
    <div
      className="fixed top-0 start-0 z-50 h-1.5 w-full origin-left rtl:origin-right animate-[reading-progress_linear_both] bg-sky-500 opacity-90 shadow-[0_0_8px_rgba(14,165,233,0.6)] [animation-timeline:scroll()]"
      aria-hidden="true"
    />
  );
}

export function ReadingProgress() {
  const pathname = usePathname();
  const isBlogPost = pathname?.startsWith("/blog/") && pathname !== "/blog";
  const isDocPage = pathname?.startsWith("/docs/") && pathname !== "/docs";

  if (!isBlogPost && !isDocPage) {
    return null;
  }

  return <ReadingProgressBar key={pathname} />;
}
