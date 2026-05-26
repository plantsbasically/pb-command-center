import "./globals.css";

export const metadata = {
  title: "Profit Command Center | Plants Basically",
  description: "P&L Dashboard for Plants Basically",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full bg-zinc-50 text-zinc-900 antialiased">
        {children}
      </body>
    </html>
  );
}
