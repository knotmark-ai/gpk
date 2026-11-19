// Bundled text assets are imported as strings (esbuild `loader: { ".md": "text", ".html": "text" }`).
declare module "*.md" {
  const text: string;
  export default text;
}
declare module "*.html" {
  const text: string;
  export default text;
}
