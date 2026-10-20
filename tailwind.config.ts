import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Nunito Variable", "Nunito", "ui-rounded", "system-ui", "sans-serif"],
        display: ["Fraunces Variable", "Georgia", "serif"],
      },
      colors: {
        sr: {
          paper: "#FDFCF8",
          ink: "#2C2C24",
          pine: "#5D7052",
          clay: "#C18C5D",
          sand: "#E6DCCD",
          stone: "#F0EBE5",
          timber: "#DED8CF",
          destructive: "#A85448",
        },
      },
      boxShadow: {
        soft: "0 4px 20px -2px rgba(93, 112, 82, 0.15)",
        float: "0 10px 40px -10px rgba(193, 140, 93, 0.2)",
      },
      borderRadius: {
        organic: "2rem 2rem 2rem 1.4rem",
      },
    },
  },
  plugins: [],
};

export default config;
