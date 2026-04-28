import vite = require("vite");

export default vite.defineConfig({
  build: {
    rollupOptions: {
      external: ["electron"]
    }
  }
});
