/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        sans: ["-apple-system", "BlinkMacSystemFont", "SF Pro Text", "SF Pro Display", "Inter", "Helvetica Neue", "Segoe UI", "sans-serif"],
        mono: ["SF Mono", "JetBrains Mono", "ui-monospace", "monospace"],
      },
      colors: {
        // Neutral, warm-free greys (replaces Tailwind's bluish slate everywhere).
        slate: {
          50: "#f5f5f7", 100: "#ececf0", 200: "#d2d2d7", 300: "#b8b8bd", 400: "#86868b", 500: "#6e6e73",
          600: "#515154", 700: "#424245", 800: "#2c2c2e", 900: "#1c1c1e", 950: "#000000",
        },
        brand: {
          50: "#f0f7ff", 100: "#dcecff", 200: "#b3d7ff", 300: "#7ab8ff", 400: "#2997ff", 500: "#0a84ff",
          600: "#0071e3", 700: "#0066cc", 800: "#0058b0", 900: "#003f80", 950: "#002650",
        },
      },
      letterSpacing: { tightest: "-0.035em", display: "-0.022em" },
      borderRadius: { "4xl": "2rem" },
      boxShadow: {
        card: "0 0 0 1px rgba(0,0,0,.03), 0 2px 8px rgba(0,0,0,.04)",
        pop: "0 20px 50px -12px rgba(0,0,0,.25)",
        hover: "0 8px 30px rgba(0,0,0,.08)",
      },
      keyframes: {
        "fade-in": { from: { opacity: 0, transform: "translateY(6px)" }, to: { opacity: 1, transform: "none" } },
        shimmer: { "100%": { transform: "translateX(100%)" } },
      },
      animation: { "fade-in": "fade-in .35s cubic-bezier(.25,.1,.25,1) both" },
    },
  },
  plugins: [],
};
