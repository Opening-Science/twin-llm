/**
 * Formatting for the whole repository. Wider lines than Prettier's default suit
 * the long Tailwind class lists; the plugin keeps those classes in one order.
 *
 * @type {import("prettier").Config}
 */
const formatting = {
  printWidth: 90,
  plugins: ["prettier-plugin-tailwindcss"],
};

export default formatting;
