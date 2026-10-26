"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Icons } from "./icons";

export function BackButton() {
  const pathname = usePathname();
  const router = useRouter();

  if (pathname === "/") return null;

  return (
    <button className="back-button" type="button" onClick={() => router.back()}>
      <Icons.ChevronLeft size={16} />
      Назад
    </button>
  );
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    const current = document.documentElement.dataset.theme;
    const saved = window.localStorage.getItem("theme");
    const initial = current === "dark" || current === "light" ? current : saved === "dark" ? "dark" : "light";
    document.documentElement.dataset.theme = initial;
    document.documentElement.style.colorScheme = initial;
    window.setTimeout(() => setTheme(initial), 0);
  }, []);

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    document.documentElement.style.colorScheme = next;
    window.localStorage.setItem("theme", next);
  }

  return (
    <button className="nav-button theme-toggle" type="button" onClick={toggleTheme}>
      {theme === "dark" ? <Icons.Sun size={18} /> : <Icons.Moon size={18} />}
      {theme === "dark" ? "Светлая тема" : "Тёмная тема"}
    </button>
  );
}
