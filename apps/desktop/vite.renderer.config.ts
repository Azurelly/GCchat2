import vite = require("vite");
import react from "@vitejs/plugin-react";

export default vite.defineConfig({
  envDir: "../..",
  plugins: [react()],
  resolve: {
    dedupe: ["react", "react-dom"]
  }
});
