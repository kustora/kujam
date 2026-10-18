import { defineConfig } from 'vite';

export default defineConfig({
  // Compile-time flags of Vue's esm-bundler build; without @vitejs/plugin-vue they must be set here.
  define: {
    __VUE_OPTIONS_API__: 'true',
    __VUE_PROD_DEVTOOLS__: 'false',
    __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false',
  },
});
