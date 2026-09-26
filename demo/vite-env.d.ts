/// <reference types="vite/client" />

declare module "*.md" {
  /** The h2/h3 headings, for a table of contents. */
  export const headings: { depth: 2 | 3; id: string; text: string }[];
  const html: string;
  export default html;
}
