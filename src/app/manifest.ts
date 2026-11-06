import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "TRACE",
    short_name: "TRACE",
    description: "A personal record of becoming stronger.",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    // the launch splash's own background, so the hand-off from the OS splash is seamless
    background_color: "#121211",
    theme_color: "#121311",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
