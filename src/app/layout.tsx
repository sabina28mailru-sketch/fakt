import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Fakt — ежедневный выпуск",
  description:
    "Ежедневный контент для личного бренда на проверенных фактах: сторис, карусель и рилс с источниками.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

/*
 * Inter — интерфейс, Literata — чтение, JetBrains Mono — данные и метки.
 * У всех трёх полная кириллица; у Poppins, который стоял раньше, её нет
 * вовсе, и весь русский текст рисовался системным шрифтом.
 *
 * Все три переменные: одна загрузка отдаёт весь диапазон насыщенностей,
 * а у Literata ещё и ось оптического размера — она подстраивает контраст
 * под кегль, что для длинного текста заметно.
 */
const FONTS_HREF =
  "https://fonts.googleapis.com/css2" +
  "?family=Inter:wght@400..700" +
  "&family=Literata:opsz,wght@7..72,400..600" +
  "&family=JetBrains+Mono:wght@400..600" +
  "&display=swap";

/* Тема выставляется до первой отрисовки, чтобы не мигать при загрузке. */
const THEME_SCRIPT = `try{var t=localStorage.getItem("fakt-theme");if(t==="light"||t==="dark"){document.documentElement.setAttribute("data-theme",t)}}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link rel="stylesheet" href={FONTS_HREF} />
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
