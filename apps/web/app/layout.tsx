import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ScanerBlogers",
  description: "Локальная админка для поиска блогеров и экспертов по ключевым словам"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" data-theme="light" style={{ colorScheme: "light" }} suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              try {
                var savedTheme = localStorage.getItem("theme");
                var theme = savedTheme === "dark" || savedTheme === "light" ? savedTheme : "light";
                document.documentElement.dataset.theme = theme;
                document.documentElement.style.colorScheme = theme;
              } catch (_) {}
            `
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
