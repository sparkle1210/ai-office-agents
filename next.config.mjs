/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // โฟลเดอร์ workspace/ ถูกเขียนระหว่างรัน ไม่ให้ dev server ตามดูการเปลี่ยนแปลง
  webpack: (config) => {
    config.watchOptions = { ...config.watchOptions, ignored: ['**/workspace/**', '**/node_modules/**'] };
    return config;
  },
};
export default nextConfig;
