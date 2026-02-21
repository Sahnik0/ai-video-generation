import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/app/**/*.{ts,tsx}", "./src/components/**/*.{ts,tsx}"],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        ink: "#0b0b0b",
        bone: "#f6f4ef",
        signal: "#ff4d00",
        steel: "#1a1a1a",
        haze: "#ded6cc"
      },
      fontFamily: {
        brutal: ["Space Grotesk", "Arial", "sans-serif"],
        mono: ["IBM Plex Mono", "Consolas", "monospace"]
      }
    }
  },
  plugins: []
};

export default config;
