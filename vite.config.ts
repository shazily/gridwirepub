import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig, loadEnv } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const viteEnv = Object.fromEntries(
    Object.entries(env).filter(([key]) => key.startsWith("VITE_")),
  );

  return {
    define: Object.fromEntries(
      Object.entries(viteEnv).map(([key, value]) => [`import.meta.env.${key}`, JSON.stringify(value)]),
    ),
    plugins: [
      tailwindcss(),
      tsconfigPaths(),
      tanstackStart({
        server: { entry: "server" },
      }),
      viteReact(),
      nitro({
        externals: {
          external: ["parquetjs", "lzo", "snappyjs", "brotli", "nodemailer"],
        },
      }),
    ],
  };
});
