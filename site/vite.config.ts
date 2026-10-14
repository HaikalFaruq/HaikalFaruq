import { fileURLToPath, URL } from "node:url"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  // Relative URLs, so the build works under /HaikalFaruq/ on GitHub Pages.
  base: "./",
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  // The data is read from ../assets, next to the README graphics.
  server: { fs: { allow: [".."] } },
})
