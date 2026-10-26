"use client";

import { usePathname, useRouter } from "next/navigation";
import { type CSSProperties, type FormEvent, type ReactNode, useRef, useState, useTransition } from "react";

export function AutoFilterForm({
  children,
  className,
  style,
  autoSubmit = true,
  showStatus = true
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  autoSubmit?: boolean;
  showStatus?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isTyping, setIsTyping] = useState(false);
  const [isPending, startTransition] = useTransition();

  function apply(form: HTMLFormElement) {
    if (timer.current) clearTimeout(timer.current);
    const params = new URLSearchParams();
    const data = new FormData(form);

    for (const [key, value] of data.entries()) {
      const text = String(value).trim();
      if (!text || text === "ALL" || text === "all") continue;
      params.append(key, text);
    }

    setIsTyping(false);
    startTransition(() => {
      router.replace(params.size ? `${pathname}?${params.toString()}` : pathname, { scroll: false });
    });
  }

  function handleChange(event: FormEvent<HTMLFormElement>) {
    if (!autoSubmit) return;
    apply(event.currentTarget);
  }

  function handleInput(event: FormEvent<HTMLFormElement>) {
    if (!autoSubmit) return;
    const target = event.target as HTMLElement;
    if (target.tagName !== "INPUT") return;
    if (timer.current) clearTimeout(timer.current);
    setIsTyping(true);
    const form = event.currentTarget;
    timer.current = setTimeout(() => apply(form), 350);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    apply(event.currentTarget);
  }

  return (
    <form className={className} style={style} onChange={handleChange} onInput={handleInput} onSubmit={handleSubmit}>
      {children}
      {showStatus ? (
        <div className={`auto-filter-status ${isPending || isTyping ? "active" : ""}`} aria-live="polite">
          <span className="route-spinner" aria-hidden="true" />
          Применяем
        </div>
      ) : null}
    </form>
  );
}
