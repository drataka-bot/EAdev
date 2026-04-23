/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        accent: "#00BFFF",
        "accent-dark": "#0099cc",
        base: {
          900: "#0a0f1c",
          800: "#0d1424",
          700: "#121a2c",
          600: "#1a2338",
          500: "#243049",
          400: "#3a4666",
        },
      },
      fontFamily: {
        sans: ['"Noto Sans JP"', "sans-serif"],
      },
    },
  },
  plugins: [],
};
