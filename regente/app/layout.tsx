import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Regente | Rede Optótica",
  description: "Assessor de orquestração da rede de agentes e ferramentas.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
