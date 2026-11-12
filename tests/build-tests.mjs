import { build } from "esbuild";

/** 测试只覆盖逻辑层，把 .vue 组件桩为空模块 */
const vueStub = {
  name: "vue-stub",
  setup(b) {
    b.onResolve({ filter: /\.vue$/ }, (args) => ({
      path: args.path,
      namespace: "vue-stub",
    }));
    b.onLoad({ filter: /.*/, namespace: "vue-stub" }, () => ({
      contents: "export default {};",
      loader: "js",
    }));
  },
};

await build({
  entryPoints: [
    "tests/archive.test.ts",
    "tests/playback.test.ts",
  ],
  bundle: true,
  platform: "node",
  format: "esm",
  outdir: "tests/.build",
  outExtension: { ".js": ".mjs" },
  logLevel: "info",
  plugins: [vueStub],
});
