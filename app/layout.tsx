import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Interview Lab",
  description: "AI 模拟面试、语音练习与逐题复盘"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
