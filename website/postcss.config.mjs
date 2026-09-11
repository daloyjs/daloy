// You need postcss.config.mjs because this project uses Next.js, and Next.js processes CSS through PostCSS.

/** @type {import('postcss-load-config').Config} */
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
}

export default config

// That tailwindcss/postcss plugin:
// - Reads @import "tailwindcss"; in globals.css
// - Scans the project for Tailwind class names
// - Generates the required utility CSS
// - Processes Tailwind v4 features such as @theme, @custom-variant, and CSS-based configuration