import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { Geist, Geist_Mono, Newsreader } from "next/font/google";
import { Providers } from "@/components/providers";
import { splashScript } from "@/lib/splash";
import { themeBootScript } from "@/lib/theme";
import "./globals.css";

const geist = Geist({ variable: "--font-geist", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const newsreader = Newsreader({
  variable: "--font-newsreader",
  subsets: ["latin"],
  style: ["normal", "italic"],
  weight: ["400", "500"],
});

/** iPhone screens in CSS px and pixel ratio, portrait. */
const LAUNCH = [
  [440, 956, 3], [402, 874, 3], [430, 932, 3], [393, 852, 3], [428, 926, 3], [390, 844, 3],
  [414, 896, 3], [375, 812, 3], [414, 896, 2], [375, 667, 2], [320, 568, 2],
] as const;

export const metadata: Metadata = {
  title: { default: "TRACE", template: "%s · TRACE" },
  description: "A personal record of becoming stronger.",
  appleWebApp: {
    capable: true,
    title: "TRACE",
    // iOS shows these before any HTML arrives; plain splash background, so the animation picks up seamlessly
    startupImage: LAUNCH.map(([w, h, r]) => ({
      url: `/splash/${w * r}x${h * r}.png`,
      media: `(device-width: ${w}px) and (device-height: ${h}px) and (-webkit-device-pixel-ratio: ${r}) and (orientation: portrait)`,
    })),
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f1ea" },
    { media: "(prefers-color-scheme: dark)", color: "#121311" },
  ],
  width: "device-width",
  initialScale: 1,
  // an app, not a document: the page itself never pinch-zooms (the map has its own zoom)
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geist.variable} ${geistMono.variable} ${newsreader.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body className="min-h-full text-[15px] leading-normal">
        <script dangerouslySetInnerHTML={{ __html: splashScript }} />
        {/* lets the shell (and the splash) stream at once instead of waiting on the app's data */}
        <Providers>
          <Suspense>{children}</Suspense>
        </Providers>
      </body>
    </html>
  );
}
