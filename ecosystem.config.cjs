module.exports = {
  apps: [
    {
      name: 'webapp-dev',
      script: 'npx',
      args: 'npm run dev -- --host 0.0.0.0 --port 3000',
      env: {
        NODE_ENV: 'development',
        PORT: 3000,
      },
      watch: false,
      instances: 1,
      exec_mode: 'fork',
    },
  ],
}
