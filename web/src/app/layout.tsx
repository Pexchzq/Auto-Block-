import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BlockMesh Automation",
  description: "Premium dashboard for BlockMesh job quoting, wallet top-up, worker dispatch, and sanitized reports.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
