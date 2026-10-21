import type { NextConfig } from "next";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const nextConfig: NextConfig = {
  webpack(config, { isServer }) {
    if (isServer) {
      config.plugins.push({
        apply(compiler: { hooks: { afterEmit: { tap: (name: string, callback: () => void) => void } } }) {
          compiler.hooks.afterEmit.tap("CopyPdfWorkerForServer", () => {
            const source = join(process.cwd(), "node_modules", "pdfjs-dist", "build", "pdf.worker.mjs");
            const target = join(process.cwd(), ".next", "server", "chunks", "pdf.worker.mjs");

            if (existsSync(source)) {
              mkdirSync(dirname(target), { recursive: true });
              copyFileSync(source, target);
            }
          });
        }
      });
    }

    return config;
  }
};

export default nextConfig;
