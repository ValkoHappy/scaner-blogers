"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function ActiveNavLink({
  href,
  children
}: {
  href: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const isActive = href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link className={`nav-link${isActive ? " active" : ""}`} href={href} aria-current={isActive ? "page" : undefined}>
      {children}
    </Link>
  );
}
