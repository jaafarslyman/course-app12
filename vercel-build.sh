set -e
pnpm --filter @workspace/course-app run build
pnpm --filter @workspace/api-server exec esbuild src/app.ts \
  --bundle --platform=node --format=esm \
  --outfile=../../api/index.mjs \
  "--banner:js=import { createRequire as __r } from 'node:module'; const require = __r(import.meta.url);"
