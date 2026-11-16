import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// keepNames: a biblioteca de DWG (acad-ts) depende dos nomes das classes; sem isso o DWG sai vazio
export default defineConfig({ plugins: [react()], esbuild: { keepNames: true } });
