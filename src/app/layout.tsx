import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Southside POD | Razorpay A2A Agent Commerce Gateway",
  description: "Autonomous Agent-to-Agent (A2A) Commerce Gateway for Razorpay. Machine-readable catalog, bounded execution, and explainable audit trails.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-[#F7F7F7] text-[#0B0F19] antialiased" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
