// HTML/CSS/SVG files are imported as text via the wrangler `Text` module rule
// (see wrangler.jsonc). The default export is the file's raw contents.
declare module "*.html" {
  const content: string;
  export default content;
}

declare module "*.css" {
  const content: string;
  export default content;
}

declare module "*.svg" {
  const content: string;
  export default content;
}
