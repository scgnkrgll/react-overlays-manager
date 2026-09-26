import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import GithubSlugger from "github-slugger";
import { Marked } from "marked";
import { createHighlighter, type Highlighter } from "shiki";
import { defineConfig, type Plugin } from "vite";

const languages = ["ts", "tsx", "sh"];

const escapeHtml = (s: string) =>
  s.replace(/[&<>"]/g, (c) => `&${{ "&": "amp", "<": "lt", ">": "gt", '"': "quot" }[c]};`);

/**
 * Imports `.md` files as HTML strings, rendered at build time: code is highlighted with Shiki (light + dark themes,
 * no runtime JS) and headings get GitHub-style ids. Also exports the h2/h3 `headings` for the table of contents.
 */
function markdown(): Plugin {
  let highlighter: Promise<Highlighter> | undefined;

  return {
    name: "markdown",
    async transform(source, id) {
      if (!id.endsWith(".md")) return;
      highlighter ??= createHighlighter({ themes: ["github-light", "github-dark"], langs: languages });
      const shiki = await highlighter;
      const slugger = new GithubSlugger();
      const headings: { depth: number; id: string; text: string }[] = [];

      const marked = new Marked({
        renderer: {
          code({ text, lang }) {
            const html = shiki.codeToHtml(text, {
              lang: lang && languages.includes(lang) ? lang : "text",
              themes: { light: "github-light", dark: "github-dark" },
            });
            return `<div class="code-block">${html}<button class="copy" type="button" aria-label="Copy code">Copy</button></div>`;
          },
          heading({ tokens, depth }) {
            const inner = this.parser.parseInline(tokens);
            const text = inner.replace(/<[^>]+>/g, "");
            const id = slugger.slug(text);
            if (depth === 2 || depth === 3) headings.push({ depth, id, text });
            return `<h${depth} id="${id}"><a class="anchor" href="#${id}" aria-hidden="true">#</a>${inner}</h${depth}>\n`;
          },
        },
      });

      // The page header already shows the title and registry links, so drop the README's own.
      const body = source.replace(/^# .*\n+(\[!\[.*\n)*/, "");
      const html = marked.parse(body, { async: false });
      return {
        code: `export const headings = ${JSON.stringify(headings)};\nexport default ${JSON.stringify(html)};`,
        map: null,
      };
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), markdown()],
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  // Relative asset URLs, so the build works under any GitHub Pages path (https://<user>.github.io/<repo>/).
  base: "./",
});
