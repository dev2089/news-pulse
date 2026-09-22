import "./globals.css";

export const metadata = {
  title: "News Pulse | Topic Timeline",
  description: "A live topic-clustered news timeline for the Xponentium India full-stack assessment."
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
