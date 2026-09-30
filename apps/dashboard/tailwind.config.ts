import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        jarvis: {
          cyan: "#7fd9d8",
          green: "#7fe9a4",
          bg: "#0a0c0e",
          panel: "#0d1112",
          border: "#2a3a3f",
          gold: "#e0a24a",
          purple: "#c98bf0",
          dim: "#5a7878"
        }
      }
    },
  },
  plugins: [],
};

export default config;
