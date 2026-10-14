/** @type {import('next').NextConfig} */
const nextConfig = {
  modularizeImports: {
    'lucide-react': {
      transform: 'lucide-react/dist/esm/icons/{{ kebabCase member }}', // @uptide deep-imports
    },
    lodash: { transform: 'lodash/{{member}}' }, // @uptide deep-imports keep
  },
  experimental: { optimizePackageImports: ['lucide-react'] }, // @uptide deep-imports keep
};

export default nextConfig;
