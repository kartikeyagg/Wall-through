import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://wall-through-lab.kartikeyagg.chatgpt.site"),
  title: "Wall Through — Collaborative Vision Simulator",
  description:
    "A lightweight 2D simulation of head-mounted cameras, opaque walls, and live shared vision between police officers.",
  icons: { icon: "/og.png" },
  openGraph: {
    title: "Wall Through",
    description: "Collaborative vision simulator",
    images: ["/og.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "Wall Through",
    description: "Collaborative vision simulator",
    images: ["/og.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
