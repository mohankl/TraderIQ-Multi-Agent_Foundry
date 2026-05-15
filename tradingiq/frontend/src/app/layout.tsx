import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { CopilotKit } from "@copilotkit/react-core";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Trading IQ — Institutional equity research @ your voice command",
  description: "AI-powered equity research analyst. Get structured stock briefs instantly.",
  icons: { icon: "/trading-iq-logo.svg" },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className={`${inter.variable} antialiased`}>
        <CopilotKit runtimeUrl="/api/copilotkit/run" agent="tradingIqAgent">
          <TooltipProvider>{children}</TooltipProvider>
        </CopilotKit>
      </body>
    </html>
  );
}
