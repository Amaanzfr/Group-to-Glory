import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Group to Glory",
  description: "World Cup bracket pool and match prediction analytics.",
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
